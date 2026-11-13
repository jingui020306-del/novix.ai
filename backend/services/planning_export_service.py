from __future__ import annotations

from io import BytesIO
import re
from xml.etree.ElementTree import Element, SubElement, tostring
from zipfile import ZIP_DEFLATED, ZipFile
from services.planning_threads import thread_names


SHEETS = [
    ('情节梗概', 'important_scenes', [('scene', '场景'), ('time', '时间'), ('location', '地点'), ('characters', '出场人物'), ('plot', '情节'), ('purpose', '段落作用'), ('emotion', '情绪变化'), ('camp', '阵营'), ('attack', '交锋要点'), ('chapter', '对应章节'), ('beat_id', '对应节拍'), ('notes', '备注')]),
    ('角色交集', 'character_intersections', [('scene_id', '关联场景'), ('characters', '交集人物'), ('goal', '各自目标'), ('protagonist_action', '正方行动'), ('opponent_action', '反方行动'), ('attack_point', '交锋要点'), ('result', '结果'), ('chapter', '对应章节'), ('beat_id', '对应节拍'), ('notes', '备注')]),
    ('人物故事线', 'character_storylines', [('character_id', '人物'), ('scene_id', '关联场景'), ('goal', '人物目标'), ('obstacle', '阻碍'), ('choice', '选择与行动'), ('change', '人物变化'), ('chapter', '对应章节'), ('beat_id', '对应节拍'), ('notes', '备注')]),
    ('十五节拍表', 'beat_sheet', [('name', '节拍'), ('summary', '情势梗概'), ('scene_ids', '关联场景'), ('chapter', '对应章节'), ('emotion', '情绪变化'), ('structural_function', '结构作用'), ('notes', '备注')]),
    ('十五节拍简表', 'beat_sheet', [('name', '节拍'), ('summary', '梗概'), ('chapter', '对应章节'), ('emotion', '情绪变化')]),
]

NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'


def _xml(element):
    return tostring(element, encoding='utf-8', xml_declaration=True)


def _column(index):
    name = ''
    while index:
        index, remainder = divmod(index - 1, 26)
        name = chr(65 + remainder) + name
    return name


def export_planning_workbook(planning_card: dict, labels: dict[str, str] | None = None, chapter_order: list[str] | None = None) -> bytes:
    """Export the current form; inline strings keep author text out of formulas."""
    payload = planning_card.get('payload', {})
    if not isinstance(payload, dict):
        raise ValueError('工作表格式不正确。')
    labels = dict(labels or {})
    for key, label in [('important_scenes', 'scene'), ('beat_sheet', 'name')]:
        rows = payload.get(key, [])
        if not isinstance(rows, list):
            raise ValueError('工作表应为行列表。')
        labels.update({row['id']: str(row.get(label) or row['id']) for row in rows if isinstance(row, dict) and isinstance(row.get('id'), str)})

    def display(key, value):
        if isinstance(value, list):
            return '、'.join(display(key, item) for item in value)
        if isinstance(value, dict):
            raise ValueError('工作表单元格格式不正确。')
        value = str(value if value is not None else '')
        if key in {'characters', 'character_id', 'scene_id', 'scene_ids', 'beat_id', 'chapter'}:
            value = labels.get(value, value)
        # XML 1.0 forbids these controls; Excel limits a single cell to 32767 chars.
        return re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff\ufffe\uffff]', '', value)[:32767]

    sheet_specs = [(title, payload.get(key, []), columns) for title, key, columns in SHEETS]
    raw_threads = payload.get('plot_threads', [])
    if not isinstance(raw_threads, list) or any(not isinstance(row, dict) or not isinstance(row.get('id'), str) or not row['id'] or not isinstance(row.get('name'), str) for row in raw_threads):
        raise ValueError('故事线列表格式不正确。')
    if payload.get('plot_threads'):
        threads = thread_names(payload)
        events = payload.get('important_scenes', [])
        if not isinstance(events, list) or any(not isinstance(row, dict) for row in events):
            raise ValueError('情节梗概应为事件行列表。')
        ordered_chapters = list(dict.fromkeys(chapter_order if chapter_order is not None else [row['chapter'] for row in events if isinstance(row.get('chapter'), str) and row['chapter']]))
        columns = [('chapter', '章节'), ('time', '事件时间'), *[(f'thread_{index}', name) for index, name in enumerate(threads.values())]]
        matrix_rows = []
        for chapter in ordered_chapters:
            chapter_events = [row for row in events if row.get('chapter') == chapter]
            values = {'chapter': chapter, 'time': '\n'.join(dict.fromkeys(display('time', row['time']) for row in chapter_events if row.get('time')))}
            for index, thread_id in enumerate(threads):
                cell_events = [row for row in chapter_events if (row.get('thread_id') or 'main') == thread_id]
                values[f'thread_{index}'] = '\n\n'.join('\n'.join(value for value in [display('scene', row.get('scene', '')), display('plot', row.get('plot', '')), display('purpose', row.get('purpose', ''))] if value) for row in cell_events)
            matrix_rows.append(values)
        sheet_specs.append(('章节与线索', matrix_rows, columns))

    output = BytesIO()
    with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
        types = Element('Types', xmlns='http://schemas.openxmlformats.org/package/2006/content-types')
        for extension, content_type in [('rels', 'application/vnd.openxmlformats-package.relationships+xml'), ('xml', 'application/xml')]:
            SubElement(types, 'Default', Extension=extension, ContentType=content_type)
        for part, content_type in [('workbook.xml', 'sheet.main'), ('styles.xml', 'styles')]:
            SubElement(types, 'Override', PartName=f'/xl/{part}', ContentType=f'application/vnd.openxmlformats-officedocument.spreadsheetml.{content_type}+xml')
        relations = Element('Relationships', xmlns='http://schemas.openxmlformats.org/package/2006/relationships')
        SubElement(relations, 'Relationship', Id='rId1', Type=f'{REL_NS}/officeDocument', Target='xl/workbook.xml')
        archive.writestr('_rels/.rels', _xml(relations))
        workbook = Element('workbook', xmlns=NS, attrib={'xmlns:r': REL_NS})
        sheets = SubElement(workbook, 'sheets')
        workbook_rels = Element('Relationships', xmlns='http://schemas.openxmlformats.org/package/2006/relationships')
        for index, (title, rows, columns) in enumerate(sheet_specs, 1):
            if not isinstance(rows, list) or len(rows) > 2000 or any(not isinstance(row, dict) for row in rows):
                raise ValueError('每张工作表最多支持导出 2000 行，且每行必须是记录。')
            SubElement(sheets, 'sheet', name=title, sheetId=str(index), attrib={'r:id': f'rId{index}'})
            SubElement(workbook_rels, 'Relationship', Id=f'rId{index}', Type=f'{REL_NS}/worksheet', Target=f'worksheets/sheet{index}.xml')
            SubElement(types, 'Override', PartName=f'/xl/worksheets/sheet{index}.xml', ContentType='application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml')
            sheet = Element('worksheet', xmlns=NS)
            views = SubElement(sheet, 'sheetViews')
            view = SubElement(views, 'sheetView', workbookViewId='0')
            SubElement(view, 'pane', ySplit='1', topLeftCell='A2', activePane='bottomLeft', state='frozen')
            widths = SubElement(sheet, 'cols')
            for column_index, (field, _) in enumerate(columns, 1):
                SubElement(widths, 'col', min=str(column_index), max=str(column_index), width='42' if field in {'plot', 'summary', 'notes'} else '24', customWidth='1')
            data = SubElement(sheet, 'sheetData')
            values = [[display('header', label) for _, label in columns], *[[display(field, row.get(field, '')) for field, _ in columns] for row in rows]]
            for row_index, cells in enumerate(values, 1):
                row = SubElement(data, 'row', r=str(row_index), ht='30' if row_index == 1 else '75', customHeight='1')
                for column_index, value in enumerate(cells, 1):
                    cell = SubElement(row, 'c', r=f'{_column(column_index)}{row_index}', t='inlineStr', s='1' if row_index == 1 else '2')
                    text = SubElement(SubElement(cell, 'is'), 't', attrib={'xml:space': 'preserve'})
                    text.text = value
            SubElement(sheet, 'autoFilter', ref=f'A1:{_column(len(columns))}{len(values)}')
            archive.writestr(f'xl/worksheets/sheet{index}.xml', _xml(sheet))
        SubElement(workbook_rels, 'Relationship', Id=f'rId{len(sheet_specs) + 1}', Type=f'{REL_NS}/styles', Target='styles.xml')
        archive.writestr('[Content_Types].xml', _xml(types))
        archive.writestr('xl/workbook.xml', _xml(workbook))
        archive.writestr('xl/_rels/workbook.xml.rels', _xml(workbook_rels))
        archive.writestr('xl/styles.xml', f'''<?xml version="1.0" encoding="UTF-8"?>
<styleSheet xmlns="{NS}"><fonts count="2"><font><sz val="11"/><name val="等线"/></font><font><sz val="11"/><b/><color rgb="FFFFFFFF"/><name val="等线"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF215E66"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>''')
    return output.getvalue()

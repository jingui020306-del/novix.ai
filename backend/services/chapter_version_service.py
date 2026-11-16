"""A chapter snapshot may seed a branch or be compared without restoring it."""
from difflib import unified_diff

from services.author_data_service import STAGES_PATH
from services.edit_version_service import revision
from services.world_scope_service import entity_id
from services.information_service import InformationService


def chapter_source(store, project_id, chapter_id, version_id='current'):
    chapter = entity_id(chapter_id, '章节')
    path = f'drafts/{chapter}.md'
    if version_id != 'current':
        version = entity_id(version_id, '版本')
        history = store.read_json(project_id, f'drafts/{chapter}.meta.json').get('versions', [])
        if not any(item.get('version_id') == version for item in history):
            raise FileNotFoundError('章节快照不存在。')
        path = f'drafts/versions/{chapter}/{version}.md'
    if not store._safe_path(project_id, path).is_file():
        raise FileNotFoundError('请先保存章节正文。')
    return path, store.read_md(project_id, path)


def compare_version(store, project_id, chapter_id, version_id):
    from services.change_suggestion_service import ChangeSuggestionService
    with ChangeSuggestionService(store).lock(project_id):
        path, original = chapter_source(store, project_id, chapter_id, version_id)
        current_path, current = chapter_source(store, project_id, chapter_id)
        diff = '\n'.join(unified_diff(original.splitlines(True), current.splitlines(True),
                                     fromfile=version_id, tofile='当前正文', lineterm=''))
        information = InformationService(store)
        scope = information.world.resolve(project_id, chapter_id=chapter_id)['scope']
        stages = store.read_jsonl(project_id, STAGES_PATH)
        # Reading order controls revelation; branch/time controls which story owns it.
        stages = [row for row in stages if row.get('kind') == 'void' or
                  information.disclosure_applies(project_id, row.get('scope'), scope)]
        inactive = {key for row in stages if row.get('kind') == 'void' for key in row.get('voids', [])}
        inactive.update(row['supersedes'] for row in stages if row.get('supersedes') and row.get('status') in {'confirmed', 'retracted'})
        disclosures = []
        for row in stages:
            data = row.get('data') or {}
            if (row.get('record_type') != 'reader_disclosure' or row.get('status') != 'confirmed' or
                    row.get('id') in inactive or data.get('chapter_id') != chapter_id):
                continue
            start, end, quote = data.get('start'), data.get('end'), data.get('quote')
            if not isinstance(start, int) or not isinstance(end, int) or not isinstance(quote, str):
                continue
            if (original[start:end] == quote) != (current[start:end] == quote):
                disclosures.append({'id': row['id'], 'information_id': row.get('entity_id'), 'start': start, 'end': end, 'quote': quote})
        return {'version_id': version_id, 'diff': diff, 'disclosures': disclosures,
                'source_revision': revision(store, project_id, path), 'current_revision': revision(store, project_id, current_path)}

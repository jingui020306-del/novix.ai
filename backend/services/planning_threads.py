def thread_names(payload):
    """Names are a view of the saved thread list; missing event threads use main."""
    result = {'main': '主线'}
    rows = payload.get('plot_threads', [])
    for row in rows if isinstance(rows, list) else []:
        if isinstance(row, dict) and isinstance(row.get('id'), str) and row['id']:
            result[row['id']] = str(row.get('name') or ('主线' if row['id'] == 'main' else '未命名故事线'))
    return result

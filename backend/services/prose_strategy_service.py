"""Small executable prose references, reused by writing, revision and review."""
STRATEGIES = [
    {'id': 'wide_to_detail', 'title': '全景到细节', 'purpose': '先交代处境，再强调关键对象或选择。', 'sequence': '交代人物所在和可见空间→由人物的注意收拢→停在推动冲突的细节。', 'example': '渡口人声散在雾里。她找遍几张面孔，终于看见栈桥尽头那只空袖管。', 'avoid': '先遍列所有景物，再无缘无故放大一个物件。'},
    {'id': 'detail_to_setting', 'title': '细节到环境', 'purpose': '由触发物展开更大的处境。', 'sequence': '一个确实可感知的细节→人物的动作或判断→展开与之相连的空间和压力。', 'example': '门缝里渗出冷水。他退了一步，才发现整条走廊都在向下倾斜。', 'avoid': '细节与后面的环境没有因果或空间联系。'},
    {'id': 'spatial_flow', 'title': '按空间顺序移动', 'purpose': '让行走、追逐、交锋和位置变化可理解。', 'sequence': '建立人物相对位置→跟随一次行动→说明阻挡或距离变化→落到行动结果。', 'example': '她沿墙挪到窗下。桌子挡住了去门口的路，她只得先绕过他。', 'avoid': '人物瞬移、物件忽然换位，机械依次报出方位。'},
    {'id': 'sensory_follow', 'title': '跟随人物感官', 'purpose': '在有限视角中自然转移注意。', 'sequence': '人物当下注意到的信号→身体反应或联想→下一处可感知对象→形成行动。', 'example': '锁孔里传出轻响。她屏住气，指尖从杯沿移到桌下的门闩。', 'avoid': '罗列五感、无依据读心，替人物听见隔墙不可听的秘密。'},
    {'id': 'action_reaction', 'title': '动作与反应衔接', 'purpose': '让动机、交锋和局势变化连续。', 'sequence': '有动机的行动→对方的可见反应→人物调整选择→局势产生变化。', 'example': '他把信压在杯底。她没有去拿，只将杯子推回，他终于松开了手。', 'avoid': '所有人物做同一种小动作，情绪标签代替实际回应。'},
    {'id': 'delayed_reveal', 'title': '暂缓揭示', 'purpose': '在作者允许的信息边界内保留悬念。', 'sequence': '展示可核实的迹象或反应→让人物采取行动→在已确认位置揭示原因。', 'example': '他看清来人的鞋，先把门关了一半。直到那人开口，她才想起这个声音。', 'avoid': '视角人物明知却故意不让自己想到；为悬念新增秘密或篡改披露计划。'},
    {'id': 'focus_closure', 'title': '聚焦与收束', 'purpose': '在关键选择或情绪节点形成分量。', 'sequence': '压低次要背景→选择一个有作用的动作或物件→完成选择→以变化后的状态收束。', 'example': '屋里还在争论。她将钥匙放到门外，关门时没有再回头。', 'avoid': '每句都特写、堆叠比喻，段尾只重复解释人物心情。'},
]

BASE_RULES = ('输出可阅读的小说正文，不出现镜头推进、切换特写等机位标签。服从作者意图和已确认事实；'
    '按当前视角组织观察顺序，保持人物与物件的空间位置、动作和时间连续。细节服务目标、情绪与变化，'
    '用动作、对白、注意转移和选择体现差异，不机械复现性格习惯，不罗列五感或堆砌比喻。'
    '人物的相信不改写为真相，人物不可感知的事不进入其视角；不得借描写新增剧情或提前披露秘密。')

REVIEW_CATEGORIES = ['observation_order', 'space_action', 'detail_purpose', 'character_difference', 'repetition', 'overwriting', 'information_boundary']


def prose_guidance(direction=None):
    direction = direction or {}
    if not isinstance(direction, dict):
        raise ValueError('场景写法须为对象。')
    key = direction.get('prose_strategy') or ''
    selected = next((item for item in STRATEGIES if item['id'] == key), None)
    if key and not selected:
        raise ValueError('请选择已有的文字观察顺序，或留空沿用作者要求。')
    return {'rules': BASE_RULES, 'strategy': selected, 'author_direction': direction}

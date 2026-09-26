import io, sys
sys.stdout.reconfigure(encoding='utf-8')

p = '.ref/dom_verify.mjs'
s = io.open(p, encoding='utf-8').read()

old = """    if (window.AS && window.AS.app && window.AS.app.generate) window.AS.app.generate();
    return out;"""
new = """    /* 表单默认值已清空，自检前必须填一份测试数据，否则生成的是空卡 */
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
    set('cardTitle', '2026届高三第一次模拟考试');
    set('cardSubject', '数学');
    set('choiceTotal', '12'); set('choiceStart', '1');
    set('subjStart', '13'); set('subjCount', '5');
    set('subjScore', '10,12,12,12,12'); set('subjLines', '8');
    if (window.AS && window.AS.app && window.AS.app.generate) window.AS.app.generate();
    return out;"""
if old not in s:
    print('!! anchor not found')
    sys.exit(1)
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')

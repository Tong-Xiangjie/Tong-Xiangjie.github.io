import io
p = 'js/pdf/measure.js'
L = io.open(p, encoding='utf-8').read().split('\n')
# 删掉 lineTextOf（第 456..473 行，1-based）—— 没有任何调用点
assert '取某个文字节点中' in L[455], L[455][:40]
assert 'function lineTextOf' in L[457], L[457][:40]
assert L[472].strip() == '', repr(L[472])
new = L[:455] + L[473:]
io.open(p, 'w', encoding='utf-8', newline='\n').write('\n'.join(new))
print('ok: lines %d -> %d' % (len(L), len(new)))

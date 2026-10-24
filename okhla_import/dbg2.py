import sys
sys.argv=["x"]
exec(open("test_house_fix.py").read().split("res = H.resolve")[0])
import house_fix as H
from collections import Counter
res=H.resolve(roll,ours,draft)
def conf(j): return res[j][1] in("agreed","cleaned") and not roll[j]["deleted_in_2025_roll_code"].strip()
c=Counter();ex=[]
for i,r in enumerate(roll):
    if not(59<=int(r["part_2025"])<=69) or not r["deleted_in_2025_roll_code"].strip(): continue
    key=(r["part_2025"],r["section_no_2025"])
    if not key[1].strip(): continue
    P=roll[i-1] if i>0 and (roll[i-1]["part_2025"],roll[i-1]["section_no_2025"])==key and conf(i-1) else None
    N=roll[i+1] if i+1<len(roll) and (roll[i+1]["part_2025"],roll[i+1]["section_no_2025"])==key and conf(i+1) else None
    if not(P and N): continue
    pc,nc=H.core(res[i-1][0]),H.core(res[i+1][0])
    blk=H.block_letter(r["section_name_2025"])
    pk=H.canon(r["house_no"],blk)
    good=H._good(pk,blk,True)
    kind="prev==next" if pc==nc else "differ"
    if good:
        inb=H.core(pk) in(pc,nc)
        c[kind,"pack lettered-good", "pack==neighbour" if inb else "pack not neighbour"]+=1
        if not inb and len(ex)<10: ex.append((r["part_2025"],r["serial_2025"],r["house_no"],pk,pc,nc))
    else: c[kind,"pack bad"]+=1
for k,v in sorted(c.items()):print(k,v)
print(*ex,sep="\n")

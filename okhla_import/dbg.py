import sys
sys.argv=["x"]
exec(open("test_house_fix.py").read().split("res = H.resolve")[0])
import house_fix as H
want=[("64","1228"),("68","617"),("65","79"),("64","1374"),("67","1452"),("64","298"),("66","575")]
for i,r in enumerate(roll):
    if (r["part_2025"],r["serial_2025"]) in want:
        blk=H.block_letter(r["section_name_2025"])
        o=ours.get((int(r["part_2025"]),r["epic_n"]),"");d=draft.get(r["epic_n"],"")
        print(r["part_2025"],r["serial_2025"],blk,"pack",repr(r["house_no"]),"->",repr(H.canon(r["house_no"],blk)),"| ours",repr(o),"->",repr(H.canon(o,blk)),"| draft",repr(d),"->",repr(H.canon(d,blk)))

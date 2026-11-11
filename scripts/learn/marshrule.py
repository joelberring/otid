"""Kärr: dagens regel plus «inte på öppen mark» (ägaren 2026-11-11: kärr på skött öppen mark är utdikade)."""
import numpy as np, warnings; warnings.filterwarnings('ignore')
from scipy import ndimage as ndi
from feats import features
from rules import score, clean
D={d:features(d) for d in 'ABV'}
def run(name,fn):
    out=[]; tot=np.zeros(3)
    for d in 'ABV':
        F,Y,dom=D[d]; P,R,f,ratio=score(clean(fn(F)),Y['marsh']|Y['diffuse'],dom); out.append(f'{d}: P {P:.2f} R {R:.2f} F {f:.2f} ×{ratio:.1f}'); tot+=(P,R,f)
    print(f'{name:58s}',' | '.join(out),f'| medel F {tot[2]/3:.2f}')
base=lambda F: (F['hand']<=0.3)&(F['slopelas']<=3)
run('dagens regel',base)
for o in (0.5,0.3,0.2):
    run(f'+ öppen andel < {o}',lambda F,o=o: base(F)&(F['openshare']<o))
for g in (0.8,0.7,0.6):
    run(f'+ markträffar (medel) < {g}',lambda F,g=g: base(F)&(F['groundmean']<g))
run('+ öppen < 0.3, vegetation ≥ 3 m',lambda F: base(F)&(F['openshare']<0.3)&(F['veghmean']>=3))
run('hand ≤ 0.5, lutning ≤ 3, öppen < 0.3',lambda F: (F['hand']<=0.5)&(F['slopelas']<=3)&(F['openshare']<0.3))
run('hand ≤ 0.3, medellutning10 ≤ 2.5, öppen < 0.3',lambda F: (F['hand']<=0.3)&(F['slopemean10']<=2.5)&(F['openshare']<0.3))
run('hand ≤ 0.3, medellutning10 ≤ 2, öppen < 0.3',lambda F: (F['hand']<=0.3)&(F['slopemean10']<=2.0)&(F['openshare']<0.3))

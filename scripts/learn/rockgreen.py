"""Berg i dagen, grönt och öppet på tre rutor: enkla regler på punktmolnets egenskaper mot kartritaren."""
import numpy as np, warnings; warnings.filterwarnings('ignore')
from feats import features
from rules import score, clean
D={d:features(d) for d in 'ABV'}
def run(name,target,fn,minc=12):
    out=[]; tot=0
    for d in 'ABV':
        F,Y,dom=D[d]; P,R,f,ratio=score(clean(fn(F),minc),Y[target],dom); out.append(f'{d}: P {P:.2f} R {R:.2f} F {f:.2f} ×{ratio:.1f}'); tot+=f
    print(f'{name:60s}',' | '.join(out),f'| medel F {tot/3:.2f}')
print('BERG I DAGEN')
for vh in (3,5,8):
    for t in (0.2,0.5,1.0):
        run(f'veg ≤ {vh} m, tpi30 > {t}','rock',lambda F,vh=vh,t=t:(F['veghmean']<=vh)&(F['tpi30']>t))
run('veg ≤ 5, tpi30 > 0.5, mark ≥ 0.6','rock',lambda F:(F['veghmean']<=5)&(F['tpi30']>0.5)&(F['groundmean']>=0.6))
run('veg ≤ 5, tpi30 > 0.5, ojämn ≥ 0.05','rock',lambda F:(F['veghmean']<=5)&(F['tpi30']>0.5)&(F['rough']>=0.05))
run('veg ≤ 5, tpi30 > 0.5, intensitet ≥ 3000','rock',lambda F:(F['veghmean']<=5)&(F['tpi30']>0.5)&(F['intenmean']>=3000))
run('veg ≤ 5, tpi60 > 1','rock',lambda F:(F['veghmean']<=5)&(F['tpi60']>1))
print('GRÖNT (406–410)')
run('Karttapullautin klass ≥ 4','green',lambda F:F['kp']>=4,25)
for m in (0.06,0.08,0.10,0.12):
    run(f'andel 1–3 m ≥ {m}','green',lambda F,m=m:F['midmean']>=m,25)
for m in (0.10,0.14,0.18):
    run(f'andel 0,3–3 m ≥ {m}','green',lambda F,m=m:(F['midmean']+F['lowmean'])>=m,25)
run('1–3 m ≥ 0.08 och veg ≥ 2 m','green',lambda F:(F['midmean']>=0.08)&(F['veghmean']>=2),25)
run('1–3 m ≥ 0.08 och mark < 0.5','green',lambda F:(F['midmean']>=0.08)&(F['groundmean']<0.5),25)
print('ÖPPET (401–404)')
for o in (0.5,0.7,0.85):
    run(f'öppen andel ≥ {o}','open',lambda F,o=o:F['openshare']>=o,25)
    run(f'öppen andel ≥ {o} (alla gula)','allopen',lambda F,o=o:F['openshare']>=o,25)

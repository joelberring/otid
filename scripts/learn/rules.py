import numpy as np, warnings; warnings.filterwarnings('ignore')
from scipy import ndimage as ndi
from feats import features
D={d:features(d) for d in 'AB'}
def score(pred,truth,dom,tol=3):
    """Träff med tolerans (6 m): andel av det föreslagna som ligger nära facit, och andel av facit som hittas."""
    p=pred&dom; t=truth&dom
    near_t=ndi.binary_dilation(t,iterations=tol)&dom; near_p=ndi.binary_dilation(p,iterations=tol)&dom
    P=(p&near_t).sum()/max(1,p.sum()); R=(t&near_p).sum()/max(1,t.sum()); return P,R,2*P*R/(P+R+1e-9),p.sum()/max(1,t.sum())
def clean(m,minc=25): 
    m=ndi.binary_opening(m,iterations=1); lab,n=ndi.label(m); 
    if n==0: return m
    size=ndi.sum(m,lab,range(1,n+1)); return np.isin(lab,1+np.nonzero(size>=minc)[0])
rules={
 'marsh nu (hand<=0.3, lutning<=3)': ('marsh',lambda F: (F['hand']<=0.3)&(F['slopelas']<=3)),
 'marsh: flack botten (slopemean10<=2.5, tpi60<=-0.3, hand<=1)': ('marsh',lambda F: (F['slopemean10']<=2.5)&(F['tpi60']<=-0.3)&(F['hand']<=1.0)),
 'marsh: + gles skog (veghmean<=12)': ('marsh',lambda F: (F['slopemean10']<=2.5)&(F['tpi60']<=-0.3)&(F['hand']<=1.0)&(F['veghmean']<=12)),
 'marsh: + mark syns (groundmean>=0.35)': ('marsh',lambda F: (F['slopemean10']<=2.5)&(F['tpi60']<=-0.3)&(F['hand']<=1.0)&(F['groundmean']>=0.35)),
 'berg nu ungefär (ojämnt, upphöjt)': ('rock',lambda F: (F['rough']>=0.07)&(F['tpi16']>0.15)&(F['veghmean']<6)),
 'berg: lågt och ljust (veghmean<=4, inten>=3500, tpi30>0)': ('rock',lambda F: (F['veghmean']<=4)&(F['intenmean']>=3500)&(F['tpi30']>0)),
 'berg: lågt, upphöjt (veghmean<=5, tpi30>0.3)': ('rock',lambda F: (F['veghmean']<=5)&(F['tpi30']>0.3)),
 'öppet (openshare>=0.7, jämnt)': ('open',lambda F: (F['openshare']>=0.7)&(F['rough']<0.08)),
 'grönt KP (klass>=4)': ('green',lambda F: F['kp']>=4),
 'grönt: tätt 1–3 m (midmean>=0.12)': ('green',lambda F: F['midmean']>=0.12),
 'grönt: tätt 1–3 m (midmean>=0.08)': ('green',lambda F: F['midmean']>=0.08),
}
for name,(t,fn) in rules.items():
    out=[]
    for d in 'AB':
        F,Y,dom=D[d]; P,R,f,ratio=score(clean(fn(F)),Y[t],dom); out.append(f'{d}: P {P:.2f} R {R:.2f} F {f:.2f} yta×{ratio:.1f}')
    print(f'{name:62s}', ' | '.join(out))

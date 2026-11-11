"""Kärr som objekt, tre rutor: träna på två, pröva på den tredje."""
import numpy as np, warnings; warnings.filterwarnings('ignore')
from scipy import ndimage as ndi
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.tree import DecisionTreeClassifier, export_text
from feats import features, fillnan
from load import load
from rules import score
import objects as O
SQ='ABV'; OBJ={}
for d in SQ:
    F,Y,dom=features(d); F['zs']=ndi.gaussian_filter(fillnan(load(d)['z']),1)
    lab,n=O.candidates(F,dom); X=O.objfeats(F,lab,n); truth=Y['marsh']|Y['diffuse']
    ov=ndi.mean(truth.astype(float),lab,np.arange(1,n+1)); OBJ[d]=(lab,n,X,ov>=0.25,truth,dom,F)
    P,R,f,ratio=score(lab>0,truth,dom); now=(F['hand']<=0.3)&(F['slopelas']<=3); P2,R2,f2,r2=score(now,truth,dom)
    print(f'{d}: {n} kandidater, {int((ov>=0.25).sum())} kärr | dagens regel P {P2:.2f} R {R2:.2f} yta×{r2:.1f} | alla kandidater P {P:.2f} R {R:.2f} yta×{ratio:.1f}')
FE=O.FE
for te in SQ:
    tr=[d for d in SQ if d!=te]
    X=np.vstack([OBJ[d][2] for d in tr]); y=np.concatenate([OBJ[d][3] for d in tr])
    labt,nt,Xt,yt,trutht,domt,Ft=OBJ[te]
    m=HistGradientBoostingClassifier(max_iter=120,max_leaf_nodes=6,learning_rate=0.08,class_weight='balanced',random_state=0).fit(X,y,sample_weight=X[:,0])
    p=m.predict_proba(Xt)[:,1]; row=[]
    for th in (0.2,0.4,0.6):
        keep=np.concatenate([[False],p>=th]); P,R,f,ratio=score(keep[labt],trutht,domt); row.append(f'tröskel {th}: P {P:.2f} R {R:.2f} F {f:.2f} yta×{ratio:.1f}')
    t=DecisionTreeClassifier(max_depth=3,min_samples_leaf=10,class_weight='balanced',random_state=0).fit(X,y,sample_weight=X[:,0])
    keep=np.concatenate([[False],t.predict(Xt)]); P,R,f,ratio=score(keep[labt],trutht,domt)
    print(f'-- prövad på {te} (tränad på {"+".join(tr)}):',' | '.join(row),f'| enkelt träd: P {P:.2f} R {R:.2f} F {f:.2f} yta×{ratio:.1f}')
X=np.vstack([OBJ[d][2] for d in SQ]); y=np.concatenate([OBJ[d][3] for d in SQ])
t=DecisionTreeClassifier(max_depth=3,min_samples_leaf=12,class_weight='balanced',random_state=0).fit(X,y,sample_weight=X[:,0])
print('Träd på alla tre:'); print(export_text(t,feature_names=FE,decimals=2))
for k in ('low','vegh','ground','sink','rim','rimshare','slope','hand','open','inten','area'):
    i=FE.index(k); print(f'  {k:9s} kärr median {np.median(X[y,i]):8.2f}   övriga {np.median(X[~y,i]):8.2f}')

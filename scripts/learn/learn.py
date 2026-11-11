import numpy as np, warnings; warnings.filterwarnings('ignore')
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import roc_auc_score, precision_recall_curve
from sklearn.inspection import permutation_importance
from feats import features
D={d:features(d) for d in 'AB'}
names=[k for k in D['A'][0]]
def XY(d,target,sub=None,seed=0):
    F,Y,dom=D[d]; X=np.stack([F[k][dom] for k in names],1); y=Y[target][dom]
    return X,y
def bestf1(y,p):
    pr,rc,th=precision_recall_curve(y,p); f=2*pr*rc/(pr+rc+1e-9); i=f.argmax(); return f[i],pr[i],rc[i]
for target in ['marsh','diffuse','rock','green','rough_open','open','und']:
    print('==',target)
    for tr,te in (('A','B'),('B','A')):
        X,y=XY(tr,target); Xt,yt=XY(te,target)
        m=HistGradientBoostingClassifier(max_iter=150,max_leaf_nodes=15,learning_rate=0.1,class_weight='balanced',random_state=0).fit(X,y)
        p=m.predict_proba(Xt)[:,1]; f,pr,rc=bestf1(yt,p)
        rng=np.random.default_rng(0); idx=rng.choice(len(yt),40000,replace=False)
        imp=permutation_importance(m,Xt[idx],yt[idx],n_repeats=2,random_state=0,scoring='average_precision').importances_mean
        top=sorted(zip(imp,names),reverse=True)[:6]
        print(f' train {tr} test {te}: AUC {roc_auc_score(yt,p):.3f} bestF1 {f:.2f} (P {pr:.2f} R {rc:.2f}) top:', ', '.join(f'{n} {v:.3f}' for v,n in top))

# Run: python3 scripts/validation/berar-lelann/white_noise.py (results quoted in tests/berar-lelann.test.ts).
# Independent implementation (plain loops over explicit runs) of S''/S for white noise.
import math, random
random.seed(7)
def ratio(a):
    z=[0.0]+[ (lambda q:q/(2+q))(math.sqrt(2*math.pi*(a[i]**2+a[i-1]**2))) if a[i]*a[i-1]>0 else 0.0 for i in range(1,len(a))]
    quad=sum((1-zi*zi)*ai*ai for zi,ai in zip(z,a))
    lin=0.0;i=0
    while i<len(a):
        if z[i]>0:
            t=0.0
            while i<len(a) and z[i]>0: t+=z[i]*a[i]; i+=1
            lin+=t*t
        else: i+=1
    return quad+lin, sum(x*x for x in a)
num=den=0
for _ in range(20):
    a=[random.gauss(0,1) for _ in range(100000)]
    n,d=ratio(a); num+=n; den+=d
print(num/den, math.sqrt(num/den))
print(math.sqrt(ratio([1,2,3,-1,-2])[0]/19))

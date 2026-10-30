import {describe, expect, it} from "vitest";
import {cartonQr, decodeCompactQr, shortReference} from "./codes";
import {parseQr} from "./domain";

describe("short, reversible carton codes",()=>{
  const id="CT-0123456789ABCDEF0123";
  it("uses the same compact reference vector as the server",()=>{
    expect(cartonQr({id,revision:1,companyId:"demo"})).toBe("QASNFZ4mrze8BIw.1");
    expect(shortReference(id)).toBe("CASNFZ4mrze8BIw");
    expect(shortReference("PK-0123456789ABCDEF0123")).toBe("PASNFZ4mrze8BIw");
    expect(cartonQr({id,revision:1,companyId:"demo"}).length).toBe(17);
  });
  it("retains every identity bit and does not merge different cartons",()=>{
    const codes=new Set<string>();
    for(let i=0;i<256;i++){
      const carton="CT-"+((BigInt(i)<<72n)|BigInt(i+1)).toString(16).padStart(20,"0").toUpperCase();
      const code=cartonQr({id:carton,companyId:"demo",revision:i+1});codes.add(code);
      expect(parseQr(code,"demo")).toEqual({id:carton,revision:i+1});
    }
    expect(codes.size).toBe(256);
  });
  it("preserves label revisions through the maximum server revision",()=>{
    for(const revision of [1,2,35,36,9999,2147483647])expect(decodeCompactQr(cartonQr({id,companyId:"demo",revision}))).toEqual({id,revision});
    expect(cartonQr({id,companyId:"demo",revision:1})).not.toBe(cartonQr({id,companyId:"demo",revision:2}));
  });
  it("rejects noncanonical codes and invalid revision values",()=>{
    for(const code of ["QAAAAAAAAAAAAAR.1","QAAAAAAAAAAAAAQ.0","QAAAAAAAAAAAAAQ.01","QAAAAAAAAAAAAAQ.ZIK0ZK","QASNFZ4mrze8BIw.-1","QASNFZ4mrze8BIw.1|extra"]){expect(decodeCompactQr(code)).toBeNull();expect(()=>parseQr(code,"demo")).toThrow();}
    for(const revision of [0,-1,1.5,2147483648])expect(()=>cartonQr({id,companyId:"demo",revision})).toThrow();
  });
  it("continues to accept already printed QR labels and nonstandard test IDs",()=>{
    expect(parseQr("K1|demo|"+id+"|2","demo")).toEqual({id,revision:2});
    expect(cartonQr({id:"CT-TEST",revision:1,companyId:"demo"})).toBe("K1|demo|CT-TEST|1");
    expect(shortReference("TRIAL-10")).toBe("TRIAL-10");
  });
});

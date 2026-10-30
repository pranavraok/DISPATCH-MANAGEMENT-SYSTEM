// @vitest-environment jsdom
import {cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {App} from "./main";
import {workFixture} from "./work-fixture";
import {projectWork, type WorkScope} from "./work";

const json=(value:unknown)=>new Response(JSON.stringify(value),{status:200,headers:{"Content-Type":"application/json"}});
let state:ReturnType<typeof workFixture>;
let commands:{type:string;data:Record<string,any>}[];
beforeEach(()=>{
  window.history.replaceState(null,"","/#cartons");localStorage.clear();
  state=workFixture();commands=[];
  vi.stubGlobal("AudioContext",class {
    state="running";currentTime=0;
    async resume(){}
    createOscillator(){return {connect(){},frequency:{value:0},start(){},stop(){}};}
    createGain(){return {connect(){},gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}}};}
    destination={};
  });
  vi.stubGlobal("fetch",vi.fn(async(url:string,options?:RequestInit)=>{
    if(url==="/api/auth/me")return json({user:{name:"Scan Tester",roles:["Admin"]},csrf:"fixture"});
    if(url==="/api/state")return json(state);
    if(url.startsWith("/api/work/")){const[kind,id]=url.split("?")[0].split("/").slice(3);return json({...projectWork(state,{kind,id}as WorkScope),hasMore:false});}
    if(url==="/api/commands"){
      const request=JSON.parse(String(options?.body));commands.push(request);
      if(request.type==="attachLabels"){
        for(const c of state.cartons.filter(c=>request.data.ids.includes(c.id))){c.attached=true;c.verified=true;}
        return json({message:"Labels and contents confirmed."});
      }
      if(request.type==="startLoading"){
        state.loadingSessions=[{id:"SESSION",shipmentId:request.data.shipmentId,station:request.data.station}];
        return json({id:"SESSION",message:"Ready."});
      }
      if(request.type==="scan"){
        const c=state.cartons.find(c=>c.id==="CT-TWO")!;c.state="Loaded";
        state.allocations.find(a=>a.cartonId===c.id)!.state="Loaded";
        return json({outcome:"Accepted",id:c.id,message:"Carton loaded. All item quantities are saved."});
      }
      throw Error("Unexpected command "+request.type);
    }
    throw Error("Unexpected request "+url);
  }));
});
afterEach(()=>{cleanup();localStorage.clear();vi.unstubAllGlobals();vi.restoreAllMocks();});

describe("one scan under Labels",()=>{
  it("confirms the labels and contents without a QR verification form",async()=>{
    const c=state.cartons.find(c=>c.id==="CT-FREE")!;c.attached=false;c.verified=false;
    vi.spyOn(window,"confirm").mockReturnValue(true);
    render(<App/>);await screen.findByRole("heading",{name:/^Labels/});
    expect(screen.queryByLabelText("Verification QR")).toBeNull();
    expect(within(screen.getByRole("navigation",{name:"Main navigation"})).queryByRole("button",{name:"Loading"})).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("Search carton, group or status"),{target:{value:"CT-FREE"}});
    fireEvent.click(await screen.findByRole("checkbox",{name:"Select CT-FREE"}));
    fireEvent.click(screen.getByRole("button",{name:"Confirm labels & contents"}));
    await waitFor(()=>expect(commands.map(c=>c.type)).toEqual(["attachLabels"]));
    expect(commands[0].data.physicalConfirmed).toBe(true);
    expect(commands[0].data.contentsConfirmed).toBe(true);
    expect(commands[0].data.revisions).toEqual([{id:"CT-FREE",revision:1}]);
    expect(c.verified).toBe(true);
  });

  it("records loading with one QR submission in Labels and restores that view on refresh",async()=>{
    const first=render(<App/>);await screen.findByRole("heading",{name:/^Labels/});
    fireEvent.click(screen.getByRole("button",{name:"Scan for dispatch"}));
    fireEvent.change(screen.getByLabelText("Customer shipment"),{target:{value:"SHIP-B"}});
    await waitFor(()=>expect(screen.queryByText("Opening selected work.")).toBeNull());
    fireEvent.click(screen.getByRole("button",{name:"Start scanning & turn on sound"}));
    const input=screen.getByLabelText("SCAN CARTON QR") as HTMLInputElement;
    await waitFor(()=>expect(input.disabled).toBe(false));
    fireEvent.focus(input);fireEvent.change(input,{target:{value:"K1|demo|CT-TWO|1"}});
    fireEvent.submit(input.closest("form")!);
    await waitFor(()=>expect(first.container.querySelector(".load-big")?.textContent?.replace(/\s/g,"")).toBe("1/1"));
    expect(commands.map(c=>c.type)).toEqual(["startLoading","scan"]);
    expect(screen.getAllByLabelText("SCAN CARTON QR")).toHaveLength(1);
    expect(window.location.hash).toBe("#cartons");
    first.unmount();render(<App/>);
    expect(await screen.findByLabelText("SCAN CARTON QR")).toBeTruthy();
    expect((screen.getByLabelText("Customer shipment") as HTMLSelectElement).value).toBe("SHIP-B");
  });

  it("routes older Loading bookmarks to the sole scanner in Labels",async()=>{
    window.history.replaceState(null,"","/?work=shipment:SHIP-B#loading");
    render(<App/>);await screen.findByRole("heading",{name:"Labels"});
    expect(screen.getByLabelText("SCAN CARTON QR")).toBeTruthy();
    expect(screen.queryByLabelText("Verification QR")).toBeNull();
  });

  it("keeps an uncertain scan visible and prevents switching to printing",async()=>{
    localStorage.setItem("electro-group-uncertain-scan-v1",JSON.stringify({envelope:{requestId:"uncertain"},shipmentId:"SHIP-B",at:new Date().toISOString()}));
    render(<App/>);await screen.findByRole("button",{name:"Check saved result"});
    fireEvent.click(screen.getByRole("button",{name:"Print & attach labels"}));
    expect(screen.getByRole("alert").textContent).toContain("Check the last scan result");
    expect(screen.getByRole("button",{name:"Check saved result"})).toBeTruthy();
  });
});

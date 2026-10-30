// @vitest-environment jsdom
import {cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vitest";
import {App} from "./main";
import {workFixture} from "./work-fixture";
import {projectWork} from "./work";

afterEach(()=>{cleanup();localStorage.clear();vi.unstubAllGlobals();});
function setup({roles=["Admin"],failure=false,selected=false}={}) {
  localStorage.clear(); window.history.replaceState(null,"",selected ? "/?work=packing:PACK-B#packing" : "/#packing");
  const data=workFixture(), commands: any[]=[];
  const fetcher=vi.fn(async(url:string,options?:RequestInit)=>{
    const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
    if(url==="/api/auth/me")return json({user:{name:"Deletion tester",roles},csrf:"test"});
    if(url==="/api/state")return json(data);
    if(url.startsWith("/api/work/packing/")) {
      const id=url.split("/").at(-1)!;
      if(!data.manifests.some(m=>m.id===id))return json({error:"Deleted work should not be fetched"},404);
      return json({...projectWork(data,{kind:"packing",id}),hasMore:false});
    }
    if(url==="/api/commands") {
      const envelope=JSON.parse(options?.body as string); commands.push(envelope);
      if(failure)return json({error:"This list changed. Refresh before deleting."},409);
      data.manifests=data.manifests.filter(m=>m.id!==envelope.data.id);
      data.cartons=data.cartons.filter(c=>c.manifestId!==envelope.data.id);
      return json({message:"Packing list deleted."});
    }
    throw Error("Unexpected request "+url);
  });
  vi.stubGlobal("fetch",fetcher);render(<App/>);return {commands,fetcher};
}
async function openDelete(){
  const row=await screen.findByText("Packing Beta",{selector:"td strong"});
  fireEvent.click(within(row.closest("tr")!).getByRole("button",{name:"Delete packing list"}));
  return screen.getByRole("dialog",{name:"Delete packing list"});
}
describe("delete work controls",()=>{
  it("requires an explicit confirmation and reason, then clears a deleted work selection",async()=>{
    const {commands}=setup({selected:true});const dialog=await openDelete();
    const submit=within(dialog).getByRole("button",{name:"Delete packing list"});
    expect((submit as HTMLButtonElement).disabled).toBe(true);expect(commands).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText("Reason for deleting"),{target:{value:"Entered by mistake"}});
    fireEvent.click(within(dialog).getByRole("checkbox"));fireEvent.click(submit);
    await waitFor(()=>expect(screen.queryByRole("dialog")).toBeNull());
    expect(commands).toHaveLength(1);expect(commands[0]).toMatchObject({type:"deleteManifest",data:{id:"PACK-B",version:1,confirmed:true,reason:"Entered by mistake"}});
    expect((screen.getByLabelText("Show work") as HTMLSelectElement).value).toBe("all");
    expect(screen.queryByText("Deleted work should not be fetched")).toBeNull();
  });
  it("keeps the record when the operator cancels and shows server conflicts",async()=>{
    const {commands}=setup({failure:true});let dialog=await openDelete();
    fireEvent.click(within(dialog).getByRole("button",{name:"Keep packing list"}));expect(commands).toHaveLength(0);
    dialog=await openDelete();fireEvent.change(within(dialog).getByLabelText("Reason for deleting"),{target:{value:"Duplicate entry"}});fireEvent.click(within(dialog).getByRole("checkbox"));fireEvent.click(within(dialog).getByRole("button",{name:"Delete packing list"}));
    await within(dialog).findByText("This list changed. Refresh before deleting.");expect(screen.getByRole("dialog")).toBeTruthy();
  });
  it("does not allow management read-only users to delete",async()=>{
    setup({roles:["MD"]});await screen.findByText("Packing Beta",{selector:"td strong"});
    for(const button of screen.getAllByRole("button",{name:"Delete packing list"}))expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});

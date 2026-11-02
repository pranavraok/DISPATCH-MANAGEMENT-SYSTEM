import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./main";
import { configureSite } from "./site";
import { brand } from "./brand";

async function start() {
  try {
    const response = await fetch("/api/site", { cache: "no-store" });
    if (!response.ok) throw Error("Company configuration unavailable.");
    const company = await response.json();
    configureSite(company);
    document.documentElement.dataset.company = company?.slug ?? "electro";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", company?.slug === "aromazon" ? "#3d2344" : "#102a46");
    document.title = brand.name + " | Dispatch";
    document.querySelector('meta[name="description"]')?.setAttribute("content", brand.name + " dispatch workspace.");
    createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
  } catch {
    const root = document.getElementById("root")!;
    root.textContent = "Could not open this company's workspace. Please refresh to try again.";
  }
}
void start();

import { useEffect, useRef, useState } from "react";
import { Modal } from "./main";

export function PhoneScanner({ onScan, close }: { onScan: (qr: string) => void; close: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false, stream: MediaStream | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    const canvas = document.createElement("canvas");
    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw Error("Camera scanning requires HTTPS (or localhost) and a supported browser.");
        const { default: jsQR } = await import("jsqr");
        const capture = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } }, audio: false });
        if (disposed) { capture.getTracks().forEach(t => t.stop()); return; }
        stream = capture;
        if (!video.current) return;
        video.current.srcObject = stream; await video.current.play();
        function read() {
          if (disposed || !video.current) return;
          const v=video.current;
          if (v.readyState >= 2 && v.videoWidth) {
            canvas.width=Math.min(v.videoWidth,960); canvas.height=Math.round(v.videoHeight*canvas.width/v.videoWidth);
            const context=canvas.getContext("2d", { willReadFrequently: true });
            if (context) {
              context.drawImage(v,0,0,canvas.width,canvas.height);
              const data=context.getImageData(0,0,canvas.width,canvas.height);
              const code=jsQR(data.data,data.width,data.height,{ inversionAttempts:"dontInvert" });
              if (code?.data) { disposed=true; stream?.getTracks().forEach(t => t.stop()); onScan(code.data); return; }
            }
          }
          timer=setTimeout(read,180);
        }
        read();
      } catch(e) { if (!disposed) setError((e as Error).message + " Check camera permission, or use the 2D scanner."); }
    }
    void start();
    return () => { disposed=true; clearTimeout(timer); stream?.getTracks().forEach(t => t.stop()); };
  }, []);
  return <Modal title="Scan one carton with phone camera" close={close}><video ref={video} muted playsInline style={{ width:"100%", maxHeight:"55vh", background:"#17121b", borderRadius:12 }} /><p>Point at one carton QR. The camera closes after reading; wait for the server confirmation before scanning the next carton.</p>{error && <p className="notice error" role="alert">{error}</p>}<button className="secondary" onClick={close}>Close camera</button></Modal>;
}

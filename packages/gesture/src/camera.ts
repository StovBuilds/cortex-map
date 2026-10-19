// One webcam stream shared by every tracker on the page (hands and head can
// run together off the same camera). Reference-counted: the camera light goes
// off when the last user lets go.

let stream: Promise<MediaStream> | null = null;
let current: MediaStream | null = null;
let users = 0;

/** For tests: how many getUserMedia calls this page has made, and whether the camera is on. */
export const cameraStats = {
  opened: 0,
  live: () => !!current?.getTracks().some((t) => t.readyState === "live"),
};

export function acquireCamera(width = 640, height = 480): Promise<MediaStream> {
  users++;
  if (!stream) {
    cameraStats.opened++;
    stream = navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: width }, height: { ideal: height }, facingMode: "user" },
      audio: false,
    });
    stream.then((m) => { current = m; }, () => {
      // a refusal must not stick: let the next try ask again
      stream = null; users = 0;
    });
  }
  return stream;
}

export function releaseCamera() {
  if (users <= 0) return;
  users--;
  if (users === 0 && stream) {
    const s = stream;
    stream = null;
    s.then((m) => m.getTracks().forEach((tr) => tr.stop())).catch(() => {});
  }
}

let probe: CanvasRenderingContext2D | null = null;
/**
 * How bright the picture is, 0 (black) … 1 (white): the mean luma of a tiny
 * copy of the current video frame. Under ~0.18 hand and face tracking start to
 * struggle. null before the video has a frame.
 */
export function measureLight(video: HTMLVideoElement): number | null {
  if (video.readyState < 2 || !video.videoWidth) return null;
  if (!probe) {
    const c = document.createElement("canvas");
    c.width = 32; c.height = 24;
    probe = c.getContext("2d", { willReadFrequently: true });
    if (!probe) return null;
  }
  probe.drawImage(video, 0, 0, 32, 24);
  const d = probe.getImageData(0, 0, 32, 24).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  return sum / (d.length / 4) / 255;
}

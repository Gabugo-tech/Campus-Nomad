import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function createMockMediaStream(type: 'voice' | 'video' = 'video'): MediaStream {
  const tracks: MediaStreamTrack[] = [];

  // Create virtual audio track
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) {
      const ctx = new AudioContextClass();
      const dst = ctx.createMediaStreamDestination();
      const oscillator = ctx.createOscillator();
      oscillator.frequency.setValueAtTime(440, ctx.currentTime);
      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(0.001, ctx.currentTime);
      oscillator.connect(gainNode);
      gainNode.connect(dst);
      oscillator.start();
      const track = dst.stream.getAudioTracks()[0];
      if (track) {
        tracks.push(track);
      }
    }
  } catch (e) {
    console.warn("Virtual audio track production fallback:", e);
  }

  // Create dynamic visual scene if video required
  if (type === 'video') {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#3b82f6';
        ctx.font = '24px sans-serif';
        ctx.fillText('Virtual Student Video Stream', 50, 100);
      }

      let angle = 0;
      const intervalId = setInterval(() => {
        if (ctx) {
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          // Draw nice moving circles to look alive
          ctx.fillStyle = '#10b981';
          ctx.beginPath();
          ctx.arc(320 + Math.cos(angle) * 120, 240 + Math.sin(angle) * 120, 30, 0, Math.PI * 2);
          ctx.fill();
          
          ctx.fillStyle = '#3b82f6';
          ctx.font = '20px sans-serif';
          ctx.fillText('Virtual Student Stream (Active)', 50, 60);
          angle += 0.03;
        } else {
          clearInterval(intervalId);
        }
      }, 100);

      const stream = (canvas as any).captureStream ? (canvas as any).captureStream(30) : null;
      if (stream) {
        const track = stream.getVideoTracks()[0];
        if (track) {
          tracks.push(track);
        }
      }
    } catch (e) {
      console.warn("Virtual video track generation fallback:", e);
    }
  }

  return new MediaStream(tracks);
}

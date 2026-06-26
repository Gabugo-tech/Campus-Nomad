import { db, auth } from './firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { logActivity } from './activity';

export interface ReelUploadTask {
  id: string;
  caption: string;
  videoUrl: string; // Base64 or external url
  campusCode: string;
  progress: number;
  status: 'pending' | 'uploading' | 'completed' | 'failed';
  error?: string;
  createdAt: Date;
}

type UploaderListener = (tasks: ReelUploadTask[]) => void;

class ReelUploaderManager {
  private tasks: ReelUploadTask[] = [];
  private listeners: Set<UploaderListener> = new Set();

  subscribe(listener: UploaderListener) {
    this.listeners.add(listener);
    listener([...this.tasks]);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach(l => l([...this.tasks]));
  }

  getTasks() {
    return [...this.tasks];
  }

  getUploadingCount() {
    return this.tasks.filter(t => t.status === 'uploading').length;
  }

  async uploadReel(caption: string, videoUrl: string, campusCode: string) {
    if (!auth.currentUser) throw new Error("Must be logged in to upload reels");

    const newTask: ReelUploadTask = {
      id: Math.random().toString(36).substring(2, 9),
      caption,
      videoUrl: videoUrl.length > 200 ? videoUrl.substring(0, 200) + '...' : videoUrl,
      campusCode,
      progress: 0,
      status: 'pending',
      createdAt: new Date()
    };

    // Store raw video URL in memory
    (newTask as any)._rawVideoUrl = videoUrl;

    this.tasks = [newTask, ...this.tasks];
    this.notify();

    // Start background upload process asynchronously
    this.processUpload(newTask.id);
  }

  private async processUpload(taskId: string) {
    const task = this.tasks.find(t => t.id === taskId);
    if (!task) return;

    task.status = 'uploading';
    task.progress = 5;
    this.notify();

    // Simulates an extremely direct responsive progress bar for instantaneous feedback
    const progressInterval = setInterval(() => {
      if (task.status === 'uploading' && task.progress < 95) {
        task.progress += Math.floor(Math.random() * 20) + 12;
        if (task.progress > 95) task.progress = 95;
        this.notify();
      }
    }, 280);

    try {
      const user = auth.currentUser;
      if (!user) throw new Error("User got disconnected");

      task.progress = 40;
      this.notify();

      const finalVideoUrl = (task as any)._rawVideoUrl;

      // Real Firestore database write
      await addDoc(collection(db, 'posts'), {
        userId: user.uid,
        userName: user.displayName || user.email?.split('@')[0],
        userAvatar: user.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${user.email}`,
        content: task.caption,
        mediaType: 'video',
        videoUrl: finalVideoUrl,
        likesCount: 0,
        commentsCount: 0,
        campus: task.campusCode,
        createdAt: serverTimestamp()
      });

      clearInterval(progressInterval);
      task.progress = 100;
      task.status = 'completed';
      this.notify();

      await logActivity(`Published a campus reel video: "${task.caption.slice(0, 30)}..."`);

      // Automatically strip the tasks off of our list after 5 seconds
      setTimeout(() => {
        this.tasks = this.tasks.filter(t => t.id !== taskId);
        this.notify();
      }, 5000);

    } catch (err: any) {
      clearInterval(progressInterval);
      task.status = 'failed';
      task.error = err.message || "Could not save post documentation";
      this.notify();
      console.error("Reels background upload failed:", err);
    }
  }
}

export const reelUploader = new ReelUploaderManager();

import { TasksBoard } from "@/components/tasks-board";

export const metadata = { title: "Tasks | SRT Mission Control" };

export default function TasksPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Tasks</h1>
        <p className="text-sm text-[rgba(255,255,255,0.5)] mt-1">
          AI-generated and manual tasks — prioritized by BrainHeart
        </p>
      </div>
      <TasksBoard />
    </div>
  );
}

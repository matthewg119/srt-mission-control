import { ChatInterface } from "@/components/chat-interface";

export const metadata = { title: "AI Assistant | SRT Mission Control" };

export default function AssistantPage() {
  return (
    <div className="-m-6 h-[calc(100vh-64px)]">
      <ChatInterface />
    </div>
  );
}

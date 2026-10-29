import { Chat } from "../../../components/Chat";

export default function ChatPage({ params }: { params: { id: string } }) {
  return <Chat conversationId={params.id} />;
}

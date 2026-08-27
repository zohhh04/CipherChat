import { useEffect } from 'react';
import ChatWindow from '../components/chat/ChatWindow';
import CallOverlay from '../components/call/CallOverlay';

export default function ChatPage() {
  useEffect(() => {
    document.title = 'Secure Chat';
  }, []);
  return (
    <>
      <ChatWindow />
      <CallOverlay />
    </>
  );
}

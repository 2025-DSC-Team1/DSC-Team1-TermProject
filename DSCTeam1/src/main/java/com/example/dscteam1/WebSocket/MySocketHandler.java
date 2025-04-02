package com.example.dscteam1.WebSocket;

import org.springframework.web.socket.*;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import java.io.IOException;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

public class MySocketHandler extends TextWebSocketHandler {

    // 연결된 클라이언트들을 저장
    private static final Set<WebSocketSession> sessions = ConcurrentHashMap.newKeySet();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        sessions.add(session);
        broadcast("📥 A client connected: " + session.getId());
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws IOException {
        System.out.println("📨 Received from " + session.getId() + ": " + message.getPayload());
        session.sendMessage(new TextMessage("서버 응답: " + message.getPayload()));
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        sessions.remove(session);
        broadcast("❌ A client disconnected: " + session.getId());
    }

    private void broadcast(String message) {
        for (WebSocketSession sess : sessions) {
            try {
                if (sess.isOpen()) {
                    sess.sendMessage(new TextMessage(message));
                }
            } catch (IOException e) {
                e.printStackTrace();
            }
        }
    }
}

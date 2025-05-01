package com.example.dscteam1.WebSocket;

import org.springframework.web.socket.*;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import java.io.IOException;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.json.JSONObject;

public class MySocketHandler extends TextWebSocketHandler {

    // 연결된 클라이언트들을 저장
    private static final Set<WebSocketSession> sessions = ConcurrentHashMap.newKeySet();

    // 공유 텍스트 내용을 저장할 변수
    private static StringBuilder sharedText = new StringBuilder();

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

    private void broadcastTextChange(JSONObject change, WebSocketSession sender) {
        for (WebSocketSession sess : sessions) {
            if (sess.isOpen() && sess != sender) {
                try {
                    sess.sendMessage(new TextMessage(change.toString()));
                } catch (IOException e) {
                    // 전송 실패 로그
                    e.printStackTrace();
                }
            }
        }
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        sessions.add(session);
        broadcast("📥 A client connected: " + session.getId());

        // 새로 연결된 클라이언트에게 현재 텍스트 상태 전송
        try {
            JSONObject initialState = new JSONObject();
            initialState.put("type", "init");
            initialState.put("text", sharedText.toString());
            session.sendMessage(new TextMessage(initialState.toString()));
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        sessions.remove(session);
        broadcast("❌ A client disconnected: " + session.getId());
        System.out.println("A client disconnected: " + session.getId());
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws IOException {
        System.out.println("📨 Received from " + session.getId() + ": " + message.getPayload());

        try {
            JSONObject jsonMessage = new JSONObject(message.getPayload());
            String type = jsonMessage.getString("type");

            switch (type) {
                case "add":
                    // 텍스트 추가
                    int addPosition = jsonMessage.getInt("position");
                    String textToAdd = jsonMessage.getString("text");

                    // 공유 텍스트에 추가
                    if (addPosition >= 0 && addPosition <= sharedText.length()) {
                        sharedText.insert(addPosition, textToAdd);
//                        broadcastTextChange(jsonMessage);
                        broadcastTextChange(jsonMessage, session);
                    }
                    break;

                case "delete":
                    // 텍스트 삭제
                    int startPos = jsonMessage.getInt("start");
                    int endPos = jsonMessage.getInt("end");

                    // 공유 텍스트에서 삭제
                    if (startPos >= 0 && endPos <= sharedText.length() && startPos <= endPos) {
                        sharedText.delete(startPos, endPos);
//                        broadcastTextChange(jsonMessage);
                        broadcastTextChange(jsonMessage, session);
                    }
                    break;

                case "edit":
                    // 텍스트 편집 (삭제 후 추가)
                    int editStartPos = jsonMessage.getInt("start");
                    int editEndPos = jsonMessage.getInt("end");
                    String newText = jsonMessage.getString("text");

                    // 공유 텍스트에서 편집
                    if (editStartPos >= 0 && editEndPos <= sharedText.length() && editStartPos <= editEndPos) {
                        sharedText.replace(editStartPos, editEndPos, newText);
//                        broadcastTextChange(jsonMessage);
                        broadcastTextChange(jsonMessage, session);
                    }
                    break;

                case "sync":
                    // 전체 텍스트 동기화 요청
                    JSONObject syncResponse = new JSONObject();
                    syncResponse.put("type", "init");
                    syncResponse.put("text", sharedText.toString());
                    session.sendMessage(new TextMessage(syncResponse.toString()));
                    break;

                default:
                    // 기타 메시지는 그대로 브로드캐스트
                    session.sendMessage(new TextMessage("서버 응답: " + message.getPayload()));
            }
        } catch (Exception e) {
            // JSON 형식이 아닌 일반 메시지 처리
            session.sendMessage(new TextMessage("서버 응답: " + message.getPayload()));
        }
    }
}
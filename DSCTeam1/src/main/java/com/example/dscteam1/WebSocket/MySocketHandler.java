package com.example.dscteam1.WebSocket;

import org.springframework.web.socket.*;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.io.IOException;
import org.json.JSONArray;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.json.JSONObject;

public class MySocketHandler extends TextWebSocketHandler {

    // 연결된 클라이언트들을 저장 아이디 → 세션 매핑
    private static final Map<String, WebSocketSession> userSessions = new ConcurrentHashMap<>();

    // 공유 텍스트 내용을 저장할 변수
    private static StringBuilder sharedText = new StringBuilder();

    private void broadcast(String message) {
        for (WebSocketSession sess : userSessions.values()) {
            if (sess.isOpen()) {
                try {
                    sess.sendMessage(new TextMessage(message));
                } catch (IOException e) {
                    e.printStackTrace();
                }
            }
        }
    }

    private void broadcastTextChange(JSONObject change, WebSocketSession sender) {
        for (WebSocketSession sess : userSessions.values()) {
            if (sess.isOpen() && sess != sender) {
                try {
                    sess.sendMessage(new TextMessage(change.toString()));
                } catch (IOException e) {
                    e.printStackTrace();
                }
            }
        }
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        // 1) 쿼리에서 userId 추출
        String userId = getUserIdFromSession(session);
        if (userId == null || userId.isBlank()) {
            session.close(CloseStatus.BAD_DATA.withReason("Invalid user ID"));
            return;
        }

        // ▶ 이미 같은 ID가 접속해 있으면, 새 세션을 거부하고 즉시 닫기
        if (userSessions.containsKey(userId)) {
            session.close(
                    CloseStatus.POLICY_VIOLATION
                            .withReason("User '" + userId + "' is already connected")
            );
            return;
        }

        // ▶ 중복이 아닐 때만 등록
        userSessions.put(userId, session);
        broadcast("📥 [" + userId + "] 님이 연결되었습니다.");

        // 유저 리스트 갱신
        broadcastUserList();

        // ▶ 초기 텍스트 전송
        JSONObject init = new JSONObject();
        init.put("type", "init");
        init.put("text", sharedText.toString());
        session.sendMessage(new TextMessage(init.toString()));
    }



    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
        String userId = getUserIdFromSession(session);
        if (userId == null) return;

        // 맵에 등록된(살아있는) 세션인지 확인
        WebSocketSession registered = userSessions.get(userId);
        if (registered != null && registered.getId().equals(session.getId())) {
            // 진짜 등록된 세션이 닫혔을 때만 제거
            userSessions.remove(userId);
            broadcast("❌ [" + userId + "] 님이 연결 종료되었습니다.");
            broadcastUserList();
        }
        // else: 이미 접속 불가로 닫힌 세션이므로 무시
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

    // 쿼리 문자열에서 user 파라미터만 파싱
    private String getUserIdFromSession(WebSocketSession session) {
        String query = session.getUri().getQuery();  // ex: "user=kim"
        if (query == null) return null;
        for (String param : query.split("&")) {
            String[] kv = param.split("=");
            if (kv.length == 2 && "user".equals(kv[0])) {
                return URLDecoder.decode(kv[1], StandardCharsets.UTF_8);
            }
        }
        return null;
    }

    private void broadcastUserList() {
        // JSON 배열로 모든 userId를
        JSONArray arr = new JSONArray();
        for (String id : userSessions.keySet()) {
            arr.put(id);
        }
        JSONObject msg = new JSONObject();
        msg.put("type", "userList");
        msg.put("users", arr);

        // 모두에게 브로드캐스트
        for (WebSocketSession sess : userSessions.values()) {
            if (sess.isOpen()) {
                try {
                    sess.sendMessage(new TextMessage(msg.toString()));
                } catch (IOException e) {
                    e.printStackTrace();
                }
            }
        }
    }
}
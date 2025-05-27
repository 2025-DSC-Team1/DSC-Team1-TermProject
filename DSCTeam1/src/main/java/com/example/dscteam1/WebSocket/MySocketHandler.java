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
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

public class MySocketHandler extends TextWebSocketHandler {

    // 연결된 클라이언트들을 저장 아이디 → 세션 매핑
    private static final Map<String, WebSocketSession> userSessions = new ConcurrentHashMap<>();

    // 공유 텍스트 내용을 저장할 변수
    private static StringBuilder sharedText = new StringBuilder();

    // 라인별 편집 권한 관리 (라인 번호 -> 클라이언트 ID)
    private static final Map<Integer, String> lineOwnership = new ConcurrentHashMap<>();

    // 사용자별 편집 중인 라인 추적 (클라이언트 ID -> 라인 번호)
    private static final Map<String, Integer> userEditingLine = new ConcurrentHashMap<>();

    // 라인별 락 타임스탬프 (라인 번호 -> 타임스탬프)
    private static final Map<Integer, Long> lineLockTimestamp = new ConcurrentHashMap<>();

    // 락 타임아웃 (30초)
    private static final long LOCK_TIMEOUT = 30000;

    // 락 체크 주기 (5초)
    private static final long LOCK_CHECK_INTERVAL = 5000;

    // 락 체크 스케줄러
    private static final ScheduledExecutorService lockChecker = Executors.newSingleThreadScheduledExecutor();

    static {
        // 주기적으로 락 타임아웃 체크
        lockChecker.scheduleAtFixedRate(() -> {
            long currentTime = System.currentTimeMillis();
            lineLockTimestamp.forEach((line, timestamp) -> {
                if (currentTime - timestamp > LOCK_TIMEOUT) {
                    String owner = lineOwnership.get(line);
                    if (owner != null) {
                        lineOwnership.remove(line);
                        userEditingLine.remove(owner);
                        lineLockTimestamp.remove(line);
                        broadcastLineOwnership();
                    }
                }
            });
        }, LOCK_CHECK_INTERVAL, LOCK_CHECK_INTERVAL, TimeUnit.MILLISECONDS);
    }

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

    private static void broadcastLineOwnership() {
        JSONObject msg = new JSONObject();
        msg.put("type", "lineOwnership");

        JSONObject ownership = new JSONObject();
        for (Map.Entry<Integer, String> entry : lineOwnership.entrySet()) {
            ownership.put(entry.getKey().toString(), entry.getValue());
        }
        msg.put("ownership", ownership);

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

    private int getLineFromPosition(int position) {
        String text = sharedText.toString();
        int lineNumber = 0;
        for (int i = 0; i < position && i < text.length(); i++) {
            if (text.charAt(i) == '\n') {
                lineNumber++;
            }
        }
        return lineNumber;
    }

    private boolean canUserEditLine(String userId, int lineNumber) {
        String owner = lineOwnership.get(lineNumber);
        if (owner == null) return true;
        
        // 락이 타임아웃되었는지 확인
        Long timestamp = lineLockTimestamp.get(lineNumber);
        if (timestamp != null && System.currentTimeMillis() - timestamp > LOCK_TIMEOUT) {
            lineOwnership.remove(lineNumber);
            userEditingLine.remove(owner);
            lineLockTimestamp.remove(lineNumber);
            return true;
        }
        
        return owner.equals(userId);
    }

    private void acquireLineLock(String userId, int lineNumber) {
        // 이전에 편집하던 라인이 있다면 해제
        Integer previousLine = userEditingLine.get(userId);
        if (previousLine != null && !previousLine.equals(lineNumber)) {
            lineOwnership.remove(previousLine);
            lineLockTimestamp.remove(previousLine);
        }

        // 새 라인 점유
        lineOwnership.put(lineNumber, userId);
        userEditingLine.put(userId, lineNumber);
        lineLockTimestamp.put(lineNumber, System.currentTimeMillis());
        broadcastLineOwnership();
    }

    private void releaseLineLock(String userId) {
        Integer editingLine = userEditingLine.get(userId);
        if (editingLine != null) {
            // 현재 라인의 락만 해제
            lineOwnership.remove(editingLine);
            userEditingLine.remove(userId);
            lineLockTimestamp.remove(editingLine);
            broadcastLineOwnership();
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

        // 현재 라인 소유권 정보 전송
        broadcastLineOwnership();
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

            // 해당 사용자가 편집 중이던 라인 해제
            releaseLineLock(userId);

            broadcast("❌ [" + userId + "] 님이 연결 종료되었습니다.");
            broadcastUserList();
        }
        // else: 이미 접속 불가로 닫힌 세션이므로 무시
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws IOException {
        System.out.println("📨 Received from " + session.getId() + ": " + message.getPayload());

        String userId = getUserIdFromSession(session);
        if (userId == null) return;

        try {
            JSONObject jsonMessage = new JSONObject(message.getPayload());
            String type = jsonMessage.getString("type");

            switch (type) {
                case "requestLineLock":
                    // 라인 편집 권한 요청
                    int requestedLine = jsonMessage.getInt("line");
                    if (canUserEditLine(userId, requestedLine)) {
                        acquireLineLock(userId, requestedLine);

                        JSONObject response = new JSONObject();
                        response.put("type", "lineLockGranted");
                        response.put("line", requestedLine);
                        session.sendMessage(new TextMessage(response.toString()));
                    } else {
                        JSONObject response = new JSONObject();
                        response.put("type", "lineLockDenied");
                        response.put("line", requestedLine);
                        response.put("owner", lineOwnership.get(requestedLine));
                        session.sendMessage(new TextMessage(response.toString()));
                    }
                    break;

                case "releaseLineLock":
                    // 라인 편집 권한 해제
                    releaseLineLock(userId);
                    break;

                case "add":
                    // 텍스트 추가
                    int addPosition = jsonMessage.getInt("position");
                    String textToAdd = jsonMessage.getString("text");

                    // 편집 권한 확인 (현재 라인만 확인)
                    int affectedLine = getLineFromPosition(addPosition);
                    if (!canUserEditLine(userId, affectedLine)) {
                        JSONObject errorResponse = new JSONObject();
                        errorResponse.put("type", "editDenied");
                        errorResponse.put("reason", "Line is being edited by another user");
                        errorResponse.put("line", affectedLine);
                        session.sendMessage(new TextMessage(errorResponse.toString()));
                        break;
                    }

                    // 공유 텍스트에 추가
                    if (addPosition >= 0 && addPosition <= sharedText.length()) {
                        sharedText.insert(addPosition, textToAdd);
                        broadcastTextChange(jsonMessage, session);
                    }
                    break;

                case "delete":
                    // 텍스트 삭제
                    int startPos = jsonMessage.getInt("start");
                    int endPos = jsonMessage.getInt("end");

                    // 편집 권한 확인 (삭제 범위의 모든 라인 확인)
                    int deleteLineStart = getLineFromPosition(startPos);
                    int deleteLineEnd = getLineFromPosition(endPos);
                    for (int line = deleteLineStart; line <= deleteLineEnd; line++) {
                        if (!canUserEditLine(userId, line)) {
                            JSONObject errorResponse = new JSONObject();
                            errorResponse.put("type", "editDenied");
                            errorResponse.put("reason", "One or more lines are being edited by another user");
                            errorResponse.put("line", line);
                            session.sendMessage(new TextMessage(errorResponse.toString()));
                            return;
                        }
                    }

                    // 공유 텍스트에서 삭제
                    if (startPos >= 0 && endPos <= sharedText.length() && startPos <= endPos) {
                        sharedText.delete(startPos, endPos);
                        broadcastTextChange(jsonMessage, session);
                    }
                    break;

                case "edit":
                    // 텍스트 편집 (삭제 후 추가)
                    int editStartPos = jsonMessage.getInt("start");
                    int editEndPos = jsonMessage.getInt("end");
                    String newText = jsonMessage.getString("text");

                    // 편집 권한 확인
                    int editLineStart = getLineFromPosition(editStartPos);
                    int editLineEnd = getLineFromPosition(editEndPos);
                    for (int line = editLineStart; line <= editLineEnd; line++) {
                        if (!canUserEditLine(userId, line)) {
                            JSONObject errorResponse = new JSONObject();
                            errorResponse.put("type", "editDenied");
                            errorResponse.put("reason", "One or more lines are being edited by another user");
                            errorResponse.put("line", line);
                            session.sendMessage(new TextMessage(errorResponse.toString()));
                            return;
                        }
                    }

                    // 공유 텍스트에서 편집
                    if (editStartPos >= 0 && editEndPos <= sharedText.length() && editStartPos <= editEndPos) {
                        sharedText.replace(editStartPos, editEndPos, newText);
                        broadcastTextChange(jsonMessage, session);
                    }
                    break;

                case "sync":
                    // 전체 텍스트 동기화 요청
                    JSONObject syncResponse = new JSONObject();
                    syncResponse.put("type", "init");
                    syncResponse.put("text", sharedText.toString());
                    session.sendMessage(new TextMessage(syncResponse.toString()));

                    // 라인 소유권 정보도 함께 전송
                    broadcastLineOwnership();

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
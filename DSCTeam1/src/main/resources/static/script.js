let socket;
let editorElement = document.getElementById("editor");
let statusElement = document.getElementById("status");
let isLocalChange = false;
let lastContent = "";

function logMessage(message) {
    const logDiv = document.getElementById("log");
    logDiv.innerText += "\n" + message;
    logDiv.scrollTop = logDiv.scrollHeight;
}

function updateStatus(status, message) {
    statusElement.className = status;
    statusElement.innerText = "연결 상태: " + message;
}

function applyPatch(data) {
    isLocalChange = true;
    const text = editorElement.textContent;
    let newText;

    switch (data.type) {
        case "add":
            newText = text.slice(0, data.position)
                + data.text
                + text.slice(data.position);
            break;
        case "delete":
            newText = text.slice(0, data.start)
                + text.slice(data.end);
            break;
        case "edit":
            newText = text.slice(0, data.start)
                + data.text
                + text.slice(data.end);
            break;
    }

    editorElement.textContent = newText;
    lastContent = newText;
    isLocalChange = false;
}

function connect() {
    if (socket && socket.readyState === WebSocket.OPEN) {
        logMessage("⚠️ 이미 연결되어 있습니다.");
        return;
    }

    if (socket && socket.readyState === WebSocket.CONNECTING) {
        logMessage("⏳ 연결 중입니다...");
        return;
    }

    updateStatus("connecting", "연결 중...");
    editorElement.contentEditable = "false";

    // WebSocket 프로토콜 자동 선택 (http->ws, https->wss)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
        logMessage("✅ 서버에 연결됨");
        updateStatus("connected", "연결됨");
        editorElement.contentEditable = "true";

        // 서버에 초기 동기화 요청
        requestSyncFromServer();
    };

    socket.onmessage = (e) => {
        try {
            const data = JSON.parse(e.data);

            if (data.type === "init") {
                // 초기 텍스트 설정
                isLocalChange = true;
                editorElement.textContent = data.text;
                lastContent = data.text;
                isLocalChange = false;
                logMessage("📩 서버에서 초기 텍스트를 받았습니다.");
            }
            else if (["add","delete","edit"].includes(data.type)) {
                applyPatch(data);
                logMessage(`📩 패치 적용: ${data.type}`);
            }
            else {
                // 일반 메시지
                logMessage("📩 " + e.data);
            }
        } catch (error) {
            // JSON이 아닌 일반 메시지 처리
            logMessage("📩 " + e.data);
        }
    };

    socket.onclose = () => {
        logMessage("❌ 연결 종료");
        updateStatus("disconnected", "연결 안됨");
        editorElement.contentEditable = "false";
        socket = null;
    };

    socket.onerror = (e) => {
        logMessage("🚨 에러 발생: " + e.message);
        updateStatus("disconnected", "오류 발생");
    };
}

function disconnect() {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.close();
    } else {
        logMessage("⚠️ 연결이 이미 닫혀있습니다.");
    }
}

function requestSyncFromServer() {
    if (socket && socket.readyState === WebSocket.OPEN) {
        const syncRequest = {
            type: "sync"
        };
        socket.send(JSON.stringify(syncRequest));
        logMessage("📤 서버에 텍스트 동기화 요청");
    }
}

// 텍스트 변경 감지 및 서버로 전송
let debounceTimer;

// 문자열 diff 계산 함수
function getDiff(oldStr, newStr) {
    let i = 0, j = 0;
    const oldLen = oldStr.length, newLen = newStr.length;
    // 공통 prefix
    while (i < oldLen && i < newLen && oldStr[i] === newStr[i]) i++;
    // 공통 suffix
    while (j < oldLen - i && j < newLen - i
    && oldStr[oldLen - 1 - j] === newStr[newLen - 1 - j]) j++;

    const removed = oldStr.slice(i, oldLen - j);
    const added   = newStr.slice(i, newLen - j);

    if (removed && added) {
        return { type: "edit", start: i, end: oldLen - j, text: added };
    } else if (removed) {
        return { type: "delete", start: i, end: oldLen - j };
    } else {
        return { type: "add", position: i, text: added };
    }
}

editorElement.addEventListener('input', () => {
    if (isLocalChange || !socket || socket.readyState !== WebSocket.OPEN) return;
    clearTimeout(debounceTimer);

    debounceTimer = setTimeout(() => {
        const current = editorElement.textContent;
        const diffMsg = getDiff(lastContent, current);
        socket.send(JSON.stringify(diffMsg));
        lastContent = current;
    }, 150);  // 150ms 딜레이
});

// 엔터 키를 눌렀을 때 줄바꿈 처리
editorElement.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault(); // 기본 동작 방지

        // 표준 방식의 줄바꿈 삽입
        const selection = window.getSelection();
        const range = selection.getRangeAt(0);
        const newLineNode = document.createTextNode('\n');
        range.deleteContents();
        range.insertNode(newLineNode);

        // 커서 위치 조정
        range.setStartAfter(newLineNode);
        range.setEndAfter(newLineNode);
        selection.removeAllRanges();
        selection.addRange(range);

        // 변경 내용 서버로 전송
        if (socket && socket.readyState === WebSocket.OPEN) {
            const currentContent = editorElement.textContent;
            const editMessage = {
                type: "edit",
                start: 0,
                end: lastContent.length,
                text: currentContent
            };
            socket.send(JSON.stringify(editMessage));
            lastContent = currentContent;
        }
    }
});

// 페이지 로드 시 연결 버튼 강조
window.onload = function() {
    const connectButton = document.querySelector('.button-group button:first-child');
    connectButton.focus();
};

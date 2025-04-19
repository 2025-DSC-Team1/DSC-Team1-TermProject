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

// 커서 위치 저장 함수
function saveCaretPosition(containerEl) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return 0;

    const range = selection.getRangeAt(0);
    const preSelectionRange = range.cloneRange();
    preSelectionRange.selectNodeContents(containerEl);
    preSelectionRange.setEnd(range.startContainer, range.startOffset);
    return preSelectionRange.toString().length;
}

// 커서 위치 복원 함수
function restoreCaretPosition(containerEl, savedPos) {
    const selection = window.getSelection();
    const range = document.createRange();
    let charIndex = 0, nodeStack = [containerEl], node, stop = false;

    while (!stop && (node = nodeStack.pop())) {
        if (node.nodeType === 3) {
            const nextCharIndex = charIndex + node.length;
            if (savedPos >= charIndex && savedPos <= nextCharIndex) {
                range.setStart(node, savedPos - charIndex);
                range.collapse(true);
                stop = true;
            }
            charIndex = nextCharIndex;
        } else {
            let i = node.childNodes.length;
            while (i--) {
                nodeStack.push(node.childNodes[i]);
            }
        }
    }

    selection.removeAllRanges();
    selection.addRange(range);
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
            else if (data.type === "add" || data.type === "delete" || data.type === "edit") {
                // 다른 클라이언트의 변경사항 적용
                if (!isLocalChange) {
                    const caretPos = saveCaretPosition(editorElement);

                    isLocalChange = true;
                    editorElement.textContent = data.fullText;
                    lastContent = data.fullText;
                    isLocalChange = false;

                    restoreCaretPosition(editorElement, caretPos);

                    logMessage(`📩 다른 클라이언트의 텍스트 변경이 적용되었습니다: ${data.type}`);
                }
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
editorElement.addEventListener('input', (event) => {
    if (isLocalChange || !socket || socket.readyState !== WebSocket.OPEN) return;

    const currentContent = editorElement.textContent;

    // 전체 내용이 변경된 경우 - 편집 메시지 전송
    const editMessage = {
        type: "edit",
        start: 0,
        end: lastContent.length,
        text: currentContent
    };

    socket.send(JSON.stringify(editMessage));
    logMessage("📤 텍스트 변경 전송");

    lastContent = currentContent;
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

let socket;
let editorElement = document.getElementById("editor");
let statusElement = document.getElementById("status");
let isLocalChange = false;
let lastContent = "";
let currentUserId = null;
let userListDisplay = document.getElementById("userListDisplay");

function logMessage(message) {
    const logDiv = document.getElementById("log");
    logDiv.innerText += "\n" + message;
    logDiv.scrollTop = logDiv.scrollHeight;
}

function updateStatus(status, message) {
    statusElement.className = status;
    statusElement.innerText = "연결 상태: " + message;
}

/**
 * contentEditable 요소 안에서 현재 커서의 문자 오프셋을 구합니다.
 */
function getCaretOffset(container) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return 0;
    const range = sel.getRangeAt(0);
    const pre = range.cloneRange();
    pre.selectNodeContents(container);
    pre.setEnd(range.startContainer, range.startOffset);
    return pre.toString().length;
}

/**
 * container 안에서 문자 오프셋 chars 위치에 커서를 놓습니다.
 */
function setCaretOffset(container, chars) {
    const sel = window.getSelection();
    const range = document.createRange();
    let nodeStack = [container], node, found = false, charCount = 0;

    while (!found && (node = nodeStack.shift())) {
        if (node.nodeType === Node.TEXT_NODE) {
            const next = charCount + node.textContent.length;
            if (chars <= next) {
                range.setStart(node, chars - charCount);
                range.collapse(true);
                found = true;
                break;
            } else {
                charCount = next;
            }
        } else {
            for (let i = 0; i < node.childNodes.length; i++) {
                nodeStack.push(node.childNodes[i]);
            }
        }
    }

    if (found) {
        sel.removeAllRanges();
        sel.addRange(range);
    }
}


function applyPatch(data) {
    isLocalChange = true;
    // 1) 수정 전 커서 위치 저장
    const oldOffset = getCaretOffset(editorElement);
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

    // 2) 텍스트 갱신
    editorElement.textContent = newText;
    lastContent = newText;
    // 3) 커서 오프셋 보정
    let newOffset = oldOffset;
    if (data.type === "add") {
        // 앞에 삽입했으면 삽입 길이만큼 커서 이동
        if (data.position <= oldOffset) {
            newOffset = oldOffset + data.text.length;
        }
    } else if (data.type === "delete") {
        const delLen = data.end - data.start;
        if (data.start < oldOffset) {
            // 커서가 삭제 구간 뒤에 있으면 delLen만큼 당겨지고,
            // 구간 안에 있으면 구간 시작으로 이동
            newOffset = Math.max(data.start, oldOffset - delLen);
        }
    } else if (data.type === "edit") {
        const delLen = data.end - data.start;
        const addLen = data.text.length;
        if (data.start < oldOffset) {
            // 뒤에 있으면, 넣은 길이-삭제된 길이 만큼 오프셋 이동
            newOffset = oldOffset + (addLen - delLen);
            // 만약 커서가 삭제 구간 안이었다면, 구간 끝으로 이동
            if (oldOffset < data.end) {
                newOffset = data.start + addLen;
            }
        }
    }

    // 4) 보정된 오프셋으로 커서 복원
    setCaretOffset(editorElement, newOffset);

    isLocalChange = false;
}

function connect() {
    // 이미 연결 혹은 연결 중 체크
    if (socket && socket.readyState === WebSocket.OPEN) {
        logMessage("⚠️ 이미 연결되어 있습니다.");
        return;
    }
    if (socket && socket.readyState === WebSocket.CONNECTING) {
        logMessage("⏳ 연결 중입니다...");
        return;
    }

    // 사용자 ID 입력 받기
    const userId = prompt("사용자 아이디를 입력하세요:");
    if (!userId || !userId.trim()) {
        logMessage("⚠️ 아이디를 입력하지 않으면 연결할 수 없습니다.");
        return;
    }
    currentUserId = userId.trim();

    // 화면에 표시
    userIdDisplay.innerText = `사용자: ${currentUserId}`;

    updateStatus("connecting", "연결 중...");
    editorElement.contentEditable = "false";

    // WS URL에 user 파라미터 추가
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws?user=${encodeURIComponent(userId)}`;

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

            // 메시지 타입에 따라 분기 처리
            switch (data.type) {
                case "init":
                    // 초기 텍스트 설정
                    isLocalChange = true;
                    editorElement.textContent = data.text;
                    lastContent = data.text;
                    isLocalChange = false;
                    logMessage("📩 서버에서 초기 텍스트를 받았습니다.");
                    break;

                case "add":
                case "delete":
                case "edit":
                    // 패치 적용
                    applyPatch(data);
                    logMessage(`📩 패치 적용: ${data.type}`);
                    break;

                case "userList":
                    // 유저 리스트 갱신
                    updateUserList(data.users);
                    break;

                default:
                    // 그 외 일반 메시지
                    logMessage("📩 " + e.data);
            }
        } catch (error) {
            // JSON 파싱 실패 시, 일반 텍스트 로그
            logMessage("📩 " + e.data);
        }
    };

    socket.onclose = (e) => {
        // 중복 접속 거부 시 코드 1008
        if (e.code === 1008) {
            logMessage("⚠️ 이미 접속 중입니다.");
            updateStatus("disconnected", "이미 접속 중");
        } else {
            logMessage("❌ 연결 종료");
            updateStatus("disconnected", "연결 안됨");
        }
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

function sendDiff() {
    const current = editorElement.textContent;
    // 변경 없으면 아무 것도 안 함
    if (current === lastContent) return;

    const diffMsg = getDiff(lastContent, current);

    // “빈 문자열 edit” 또는 “빈 add/delete” 면 무시
    if (
        (diffMsg.type === 'add'    && !diffMsg.text) ||
        (diffMsg.type === 'delete' && diffMsg.end - diffMsg.start === 0) ||
        (diffMsg.type === 'edit'   && diffMsg.start === 0
            && diffMsg.end === lastContent.length
            && diffMsg.text === '')
    ) {
        return;
    }

    socket.send(JSON.stringify(diffMsg));
    lastContent = current;
}

editorElement.addEventListener('input', (e) => {
    // 1) 로컬 업데이트나 소켓 비연결 시 무시
    if (isLocalChange || !socket || socket.readyState !== WebSocket.OPEN) return;

    // 2) 진짜 텍스트 편집이 아닌 이벤트면 무시
    const t = /** @type {InputEvent} */(e).inputType;
    if (t === 'formatBlock' || t === 'historyUndo' || t === 'historyRedo') return;

    // 3) 디바운스 걸고 최종 Diff 전송
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(sendDiff, 200);
});

editorElement.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();

        // 1) 브라우저 기본 줄바꿈 삽입 (<br> 한 번만!)
        document.execCommand('insertLineBreak');

        // 2) 서버에 change 알리기
        if (socket && socket.readyState === WebSocket.OPEN) {
            sendDiff();
        }
    }
});

// 페이지 로드 시 연결 버튼 강조
window.onload = function() {
    const connectButton = document.querySelector('.button-group button:first-child');
    connectButton.focus();
};

// 유저 리스트를 화면에 그려주는 함수
function updateUserList(users) {
    if (!users || !users.length) {
        userListDisplay.innerText = "연결된 사용자: —";
        return;
    }
    // 각 이름을 <span>으로 감싸고, ', ' 로 join
    const listHtml = users
        .map(u => `<span class="user-badge">${u}</span>`)
        .join(', ');
    userListDisplay.innerHTML = `연결된 사용자: ${listHtml}`;
}


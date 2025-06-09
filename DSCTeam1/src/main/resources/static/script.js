let socket;
let editorElement = document.getElementById("editor");
let statusElement = document.getElementById("status");
let isLocalChange = false;
let lastContent = "";
let currentUserId = null;
let userIdDisplay   = document.getElementById("userIdDisplay");
let userListDisplay = document.getElementById("userListDisplay");
let lineOwnership = {}; // 라인별 소유권 정보
let currentEditingLine = null; // 현재 편집 중인 라인
let lineElements = []; // 라인별 DOM 요소 참조

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

/**
 * 현재 커서가 위치한 라인 번호를 반환합니다.
 */
function getCurrentLineNumber() {
    const offset = getCaretOffset(editorElement);
    const text = editorElement.textContent;
    let lineNumber = 0;

    for (let i = 0; i < offset && i < text.length; i++) {
        if (text.charAt(i) === '\n') {
            lineNumber++;
        }
    }
    return lineNumber;
}

/**
 * 라인별 편집 권한을 시각적으로 표시합니다.
 */
function updateLineVisualFeedback() {
    const text = editorElement.textContent;
    const lines = text.split('\n');

    // 기존 스타일 제거
    editorElement.classList.remove('line-locked', 'line-editing');

    // 현재 라인의 편집 권한 확인
    const currentLine = getCurrentLineNumber();
    const owner = lineOwnership[currentLine];

    if (owner && owner !== currentUserId) {
        editorElement.classList.add('line-locked');
        showLineStatusMessage(`라인 ${currentLine + 1}은 ${owner}님이 편집 중입니다.`);
        // 잠긴 라인에서는 선택 불가능하도록 설정
        editorElement.style.userSelect = 'none';
    } else {
        editorElement.style.userSelect = 'text';
        if (currentEditingLine === currentLine) {
        editorElement.classList.add('line-editing');
        showLineStatusMessage(`라인 ${currentLine + 1}을 편집 중입니다.`);
    } else {
        hideLineStatusMessage();
    }
}
}

/**
 * 라인 상태 메시지를 표시합니다.
 */
function showLineStatusMessage(message) {
    let statusDiv = document.getElementById('lineStatus');
    if (!statusDiv) {
        statusDiv = document.createElement('div');
        statusDiv.id = 'lineStatus';
        statusDiv.className = 'line-status';
        document.body.appendChild(statusDiv);
    }
    statusDiv.textContent = message;
    statusDiv.style.display = 'block';
}

/**
 * 라인 상태 메시지를 숨깁니다.
 */
function hideLineStatusMessage() {
    const statusDiv = document.getElementById('lineStatus');
    if (statusDiv) {
        statusDiv.style.display = 'none';
    }
}

/**
 * 라인 편집 권한을 요청합니다.
 */
function requestLineLock(lineNumber) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        // 이미 다른 라인을 편집 중이면 먼저 해제
        if (currentEditingLine !== null && currentEditingLine !== lineNumber) {
            releaseLineLock();
        }

        const request = {
            type: "requestLineLock",
            line: lineNumber
        };
        socket.send(JSON.stringify(request));
        
        // 락 요청 상태 표시
        showLineStatusMessage(`라인 ${lineNumber + 1} 편집 권한 요청 중...`);
    }
}

/**
 * 라인 편집 권한을 해제합니다.
 */
function releaseLineLock() {
    if (socket && socket.readyState === WebSocket.OPEN && currentEditingLine !== null) {
        const request = {
            type: "releaseLineLock"
        };
        socket.send(JSON.stringify(request));
        currentEditingLine = null;
        hideLineStatusMessage();
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

    // 라인 시각 효과 업데이트
    updateLineVisualFeedback();
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

        // 연결되면 저장/불러오기 버튼 활성화
        const saveBtn = document.getElementById("saveFile");
        const loadBtn = document.getElementById("loadFile");

        console.log("before:", saveBtn.disabled, loadBtn.disabled);

        // disabled 속성 자체를 제거
        saveBtn.removeAttribute("disabled");
        loadBtn.removeAttribute("disabled");

        console.log("after:", saveBtn.disabled, loadBtn.disabled);

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
                    updateLineVisualFeedback();
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

                case "lineOwnership":
                    // 라인 소유권 정보 업데이트
                    lineOwnership = data.ownership;
                    updateLineVisualFeedback();
                    logMessage("📩 라인 소유권 정보 업데이트");
                    break;

                case "lineLockGranted":
                    // 라인 편집 권한 승인
                    currentEditingLine = data.line;
                    logMessage(`✅ 라인 ${data.line + 1} 편집 권한 획득`);
                    updateLineVisualFeedback();
                    break;

                case "lineLockDenied":
                    // 라인 편집 권한 거부
                    logMessage(`❌ 라인 ${data.line + 1} 편집 불가 (${data.owner}님이 편집 중)`);
                    updateLineVisualFeedback();
                    break;

                case "editDenied":
                    // 편집 거부
                    logMessage(`❌ 편집 거부: ${data.reason} (라인 ${data.line + 1})`);
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
        currentEditingLine = null;
        lineOwnership = {};
        hideLineStatusMessage();

        // 연결이 끊어지면 저장/불러오기 버튼 다시 비활성화
        const saveBtn = document.getElementById("saveFile");
        const loadBtn = document.getElementById("loadFile");

        // disabled 속성 완전 추가
        saveBtn.setAttribute("disabled", "");
        loadBtn.setAttribute("disabled", "");
    };

    socket.onerror = (e) => {
        logMessage("🚨 에러 발생: " + e.message);
        updateStatus("disconnected", "오류 발생");

        const saveBtn = document.getElementById("saveFile");
        const loadBtn = document.getElementById("loadFile");

        // disabled 속성 완전 추가
        saveBtn.setAttribute("disabled", "");
        loadBtn.setAttribute("disabled", "");
    };
}

function disconnect() {
    if (socket && socket.readyState === WebSocket.OPEN) {
        releaseLineLock();
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

    // "빈 문자열 edit" 또는 "빈 add/delete" 면 무시
    if (
        (diffMsg.type === 'add'    && !diffMsg.text) ||
        (diffMsg.type === 'delete' && diffMsg.end - diffMsg.start === 0) ||
        (diffMsg.type === 'edit'   && diffMsg.start === 0
            && diffMsg.end === lastContent.length
            && diffMsg.text === '')
    ) {
        return;
    }

    // 현재 라인의 편집 권한 확인
    const currentLine = getCurrentLineNumber();
    const owner = lineOwnership[currentLine];
    
    if (owner && owner !== currentUserId) {
        // 편집 권한이 없으면 변경사항 무시하고 원래 내용으로 복원
        editorElement.textContent = lastContent;
        showLineStatusMessage(`라인 ${currentLine + 1}은 ${owner}님이 편집 중입니다. 편집할 수 없습니다.`);
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

// 커서 이동 감지 및 라인 편집 권한 관리
editorElement.addEventListener('click', handleLineChange);
editorElement.addEventListener('keyup', handleLineChange);
editorElement.addEventListener('focus', handleLineChange); // 포커스 이벤트 추가

function handleLineChange() {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    const newLine = getCurrentLineNumber();
    const owner = lineOwnership[newLine];

    // 새로운 라인으로 이동했을 때
    if (newLine !== currentEditingLine) {
        // 이전 라인 권한 해제
        if (currentEditingLine !== null) {
            releaseLineLock();
        }

        // 다른 사용자가 편집 중인 라인이면 경고
        if (owner && owner !== currentUserId) {
            showLineStatusMessage(`라인 ${newLine + 1}은 ${owner}님이 편집 중입니다. 편집할 수 없습니다.`);
            return;
        }

        // 새 라인 편집 권한 요청
        requestLineLock(newLine);
    }

    // 시각적 피드백 업데이트
    updateLineVisualFeedback();
}

// 편집기에서 포커스가 벗어날 때 라인 권한 해제
editorElement.addEventListener('blur', () => {
    if (currentEditingLine !== null) {
        // 포커스가 다른 곳으로 완전히 이동했는지 확인
        setTimeout(() => {
            if (document.activeElement !== editorElement) {
                releaseLineLock();
                hideLineStatusMessage();
            }
        }, 100);
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

// 페이지 종료 시 라인 권한 해제
window.addEventListener('beforeunload', () => {
    if (socket && socket.readyState === WebSocket.OPEN) {
        releaseLineLock();
    }
});

// 키보드 이벤트 처리 개선
editorElement.addEventListener('keydown', (e) => {
    const currentLine = getCurrentLineNumber();
    const owner = lineOwnership[currentLine];

    // 편집 불가능한 라인에서의 입력 방지
    if (owner && owner !== currentUserId) {
        // 특정 키들은 허용 (방향키, 선택 등)
        const allowedKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
                           'Home', 'End', 'PageUp', 'PageDown', 'Tab'];

        if (!allowedKeys.includes(e.key) && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            showLineStatusMessage(`라인 ${currentLine + 1}은 ${owner}님이 편집 중입니다. 편집할 수 없습니다.`);
            return false;
        }
    }

    // Enter 키 처리
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();

        // 현재 라인의 편집 권한 확인
        if (owner && owner !== currentUserId) {
            showLineStatusMessage(`라인 ${currentLine + 1}은 ${owner}님이 편집 중입니다. 줄바꿈을 할 수 없습니다.`);
            return false;
        }

        // 1) 브라우저 기본 줄바꿈 삽입
        document.execCommand('insertLineBreak');

        // 2) 서버에 change 알리기
        if (socket && socket.readyState === WebSocket.OPEN) {
            sendDiff();
        }

        // 3) 새 라인으로 이동했으므로 권한 재요청
        setTimeout(() => {
            handleLineChange();
        }, 100);
    }
});

// 마우스 이벤트 처리 추가
editorElement.addEventListener('mousedown', (e) => {
    const currentLine = getCurrentLineNumber();
    const owner = lineOwnership[currentLine];

    // 편집 불가능한 라인에서의 선택 방지
    if (owner && owner !== currentUserId) {
        e.preventDefault();
        showLineStatusMessage(`라인 ${currentLine + 1}은 ${owner}님이 편집 중입니다. 선택할 수 없습니다.`);
        return false;
    }
});

/**
 * “서버에서 불러오기” 버튼 클릭 시 호출.
 * 1) GET /listFiles 호출 ⇒ JSON 배열로 파일명 목록을 받는다.
 * 2) <select id="fileDropdown"> 의 옵션을 해당 목록으로 채운다.
 * 3) #fileSelection 컨테이너 display:block 으로 변경해 보여주기.
 */
function showLoadList() {
  // 1) WebSocket 연결 상태 점검
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    alert("❌ 서버에 연결되어 있지 않습니다. 먼저 ‘연결’ 버튼을 눌러주세요.");
    return;
  }
  fetch('/listFiles')
    .then(response => response.json())
    .then(fileArray => {
      const dropdown = document.getElementById('fileDropdown');
      // 기존 옵션 모두 제거
      dropdown.innerHTML = '';

      if (fileArray.length === 0) {
        // 파일이 하나도 없으면, “선택할 수 있는 파일이 없습니다” 한 줄 추가
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '불러올 파일이 없습니다';
        dropdown.appendChild(opt);
        dropdown.disabled = true;
      } else {
        dropdown.disabled = false;
        // JSON 배열 안의 파일명들로 <option> 생성
        fileArray.forEach(fileName => {
          const opt = document.createElement('option');
          opt.value = fileName;      // 실제 서버에 요청 보낼 때 사용하는 값
          opt.textContent = fileName; // 화면에 보여줄 텍스트
          dropdown.appendChild(opt);
        });
      }

      // 파일 선택 UI 보이기
      document.getElementById('fileSelection').style.display = 'block';
    })
    .catch(err => {
      console.error('파일 목록을 가져오는 중 오류:', err);
      alert('서버에서 파일 목록을 불러오는 데 실패했습니다.');
    });
}

/**
 * “불러오기 확정” 버튼 클릭 시 호출.
 * 1) <select id="fileDropdown"> 에서 선택된 파일명 가져오기
 * 2) fetch('/load?fileName=선택된파일명', { method: 'POST' }) 호출
 * 3) 응답이 OK면 “불러오기 성공” 알림, 실패면 에러 알림.
 * 4) 파일 선택 UI 숨기기
 */
function confirmLoad() {
  const dropdown = document.getElementById('fileDropdown');
  const selectedFile = dropdown.value;
  if (!selectedFile) {
    alert('불러올 파일을 선택해 주세요.');
    return;
  }

  fetch(`/load?fileName=${encodeURIComponent(selectedFile)}`, {
    method: 'POST'
  })
    .then(response => response.text())
    .then(text => {
      if (text.startsWith('OK')) {
        alert(`"${selectedFile}" 파일을 불러왔습니다.`);
      } else {
        alert('불러오기 실패: ' + text);
      }
      hideLoadList();
    })
    .catch(err => {
      console.error('파일 불러오기 중 오류:', err);
      alert('파일 불러오기 중 네트워크 오류가 발생했습니다.');
      hideLoadList();
    });
}

/** 파일 선택 UI(#fileSelection) 숨기기 */
function hideLoadList() {
  document.getElementById('fileSelection').style.display = 'none';
}

/**
 * 저장하기 로직 → 여기서는 기존 saveToServer()를 “파일명만 입력받는” 형태로 바꿀 수도 있고,
 * 별도 드롭다운을 만들어도 되지만, 우선은 prompt로 간단히 파일명 입력 받도록 둡니다.
 * 필요하면 저장도 “파일 목록을 보여주고 선택”하게 유사하게 구현할 수 있습니다.
 */
function saveToServer() {
   // 1) WebSocket 연결 상태 점검
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    alert("❌ 서버에 연결되어 있지 않습니다. 먼저 ‘연결’ 버튼을 눌러주세요.");
    return;
  }

  let fileName = prompt("저장할 파일명을 입력하세요 (예: memo1.txt):");
  if (!fileName) {
    alert("파일명이 입력되지 않았습니다.");
    return;
  }

  fetch(`/save?fileName=${encodeURIComponent(fileName)}`, {
    method: "POST"
  })
    .then(response => response.text())
    .then(text => {
      if (text.startsWith("OK")) {
        alert(`서버에 저장되었습니다: "${fileName}"`);
      } else {
        alert("저장 실패: " + text);
      }
    })
    .catch(err => {
      alert("저장 중 네트워크 오류가 발생했습니다.");
      console.error(err);
    });
}

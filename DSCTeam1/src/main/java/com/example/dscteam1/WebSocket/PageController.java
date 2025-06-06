package com.example.dscteam1.WebSocket;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.*;
import java.io.IOException;
import java.util.List;

@Controller
public class PageController {

    @GetMapping("/")
    public String redirectToEditor() {
        return "redirect:/WebSocketTest.html"; // static/WebSocketTest.html 로 이동
    }


    @PostMapping("/save")
    @ResponseBody
    public String saveSharedText(@RequestParam("fileName") String fileName) {
        try {
            MySocketHandler.saveToFile(fileName);
            return "OK";
        } catch (IOException e) {
            e.printStackTrace();
            return "ERROR: " + e.getMessage();
        }
    }

    @PostMapping("/load")
    @ResponseBody
    public String loadSharedText(@RequestParam("fileName") String fileName) {
        try {
            MySocketHandler.loadFromFile(fileName);
            return "OK";
        } catch (IOException e) {
            e.printStackTrace();
            return "ERROR: " + e.getMessage();
        }
    }

    // GET /listFiles
    // saved_files 디렉토리 내의 모든 파일명을 JSON 배열로 반환
    // 예: ["memo1.txt", "collab.txt", ...]

    @GetMapping("/listFiles")
    @ResponseBody
    public List<String> listFiles() {
        try {
            return MySocketHandler.listSavedFiles();
        } catch (IOException e) {
            e.printStackTrace();
            // 에러 시 빈 리스트 반환
            return List.of();
        }
    }
}

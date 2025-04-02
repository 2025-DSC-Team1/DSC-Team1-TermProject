package com.example.dscteam1.WebSocket;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class PageController {

    @GetMapping("/")
    public String redirectToEditor() {
        return "redirect:/editor.html"; // static/editor.html 로 이동
    }
}

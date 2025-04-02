FROM openjdk:17-jdk-slim

# Gradle로 빌드된 JAR 복사
COPY build/libs/DSCTeam1-0.0.1-SNAPSHOT.jar app.jar

# Spring Boot 실행
ENTRYPOINT ["java", "-jar", "/app.jar"]

FROM gradle:8.6-jdk17 AS build

COPY --no-cache . /app
WORKDIR /app

# 빌드
RUN gradle build --no-daemon

# 실행용 이미지
FROM openjdk:17-jdk-slim
COPY --from=build /app/build/libs/DSCTeam1-0.0.1-SNAPSHOT.jar app.jar
ENTRYPOINT ["java", "-jar", "/app.jar"]

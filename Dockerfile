FROM node:22-bookworm AS frontend
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM eclipse-temurin:21-jre AS java
FROM mcr.microsoft.com/dotnet/sdk:8.0-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends git python3 python3-venv && rm -rf /var/lib/apt/lists/*
COPY backend/rehearsal_engines backend/rehearsal_engines
ENV NOVIX_ENGINE_DIR=/opt/novix/engines
RUN python3 backend/rehearsal_engines/install.py sabre && python3 backend/rehearsal_engines/install.py fatima

FROM python:3.11-bookworm
WORKDIR /app
ENV NOVIX_ENGINE_DIR=/opt/novix/engines JAVA_HOME=/opt/java/openjdk DOTNET_ROOT=/usr/share/dotnet
ENV PATH="/opt/java/openjdk/bin:/usr/share/dotnet:${PATH}"
COPY --from=java /opt/java/openjdk /opt/java/openjdk
COPY --from=frontend /usr/local/bin/node /usr/local/bin/node
COPY --from=build /usr/share/dotnet/host /usr/share/dotnet/host
COPY --from=build /usr/share/dotnet/shared/Microsoft.NETCore.App /usr/share/dotnet/shared/Microsoft.NETCore.App
COPY --from=build /usr/share/dotnet/dotnet /usr/share/dotnet/dotnet
COPY --from=build /opt/novix/engines /opt/novix/engines
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/ backend/
COPY models/default.json models/default.json
COPY --from=frontend /frontend/dist backend/static_dist
WORKDIR /app/backend
CMD ["sh", "-ec", "python rehearsal_engines/install.py && exec python -m uvicorn main:app --host 0.0.0.0 --port 8000"]

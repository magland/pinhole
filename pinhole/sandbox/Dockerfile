FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl git w3m ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV PIP_ROOT_USER_ACTION=ignore PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /work

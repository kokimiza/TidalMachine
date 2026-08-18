# AI Computer image: Cloudflare's computerd daemon (the container-side half of
# @cloudflare/computer's Workspace) plus a real TidalCycles + SuperCollider
# music engine. computerd gives the Worker a synced virtual filesystem and
# exec() into this container; everything below it is what actually turns
# Claude-written Tidal/Haskell into audio.
#
# Base + computerd wiring mirrors the reference example at
# github.com/cloudflare/computer/blob/main/examples/container/Dockerfile.

FROM ghcr.io/cloudflare/computer-computerd-linux-x64:0.1.0-alpha.1 AS computerd

FROM debian:stable-slim
ENV DEBIAN_FRONTEND=noninteractive

# --- computerd runtime deps (FUSE mount + TLS for its own network calls) ---
RUN apt-get update && apt-get install -y --no-install-recommends \
        fuse3 libfuse2t64 ca-certificates curl gnupg git \
    && rm -rf /var/lib/apt/lists/*

COPY --from=computerd /usr/local/bin/computerd /usr/local/bin/computerd

# --- SuperCollider / SuperDirt (the actual synthesis engine) ---
RUN apt-get update && apt-get install -y --no-install-recommends \
        supercollider-server \
        supercollider-language \
        sc3-plugins \
        jackd2 \
        build-essential \
        libgmp-dev \
        zlib1g-dev \
        pkg-config \
        libffi-dev \
        libncurses-dev \
        xz-utils \
    && rm -rf /var/lib/apt/lists/*

# sclang's bundled Qt/WebEngine class library aborts on boot when run as root
# without --no-sandbox (Chromium's zygote refuses root). computerd's exec()
# runs commands as root by default, so the audio engine runs under this
# dedicated non-root user instead; computerd itself is untouched (it needs
# root to mount FUSE).
RUN useradd -m -s /bin/bash render

# --- GHC + cabal + TidalCycles, built once at image build time ---
USER render
ENV HOME=/home/render
ENV PATH=/home/render/.ghcup/bin:/home/render/.cabal/bin:$PATH
RUN BOOTSTRAP_HASKELL_NONINTERACTIVE=1 \
    BOOTSTRAP_HASKELL_MINIMAL=1 \
    BOOTSTRAP_HASKELL_GHC_VERSION=recommended \
    BOOTSTRAP_HASKELL_CABAL_VERSION=recommended \
    curl --proto '=https' --tlsv1.2 -sSf https://get-ghcup.haskell.org | bash \
    && ghcup install ghc recommended \
    && ghcup install cabal recommended \
    && ghcup set ghc recommended \
    && ghcup set cabal recommended

# The runner project lives outside /workspace (computerd only syncs
# /workspace back to the Worker) so its dist-newstyle build cache — the
# compiled `tidal` package and its ~10 deps — survives across jobs. Each
# render only needs to interpret the small per-job Main.hs against it.
WORKDIR /opt/tidal-runner
COPY --chown=render:render container-src/tidal-runner/tidal-runner.cabal ./
COPY --chown=render:render container-src/tidal-runner/Main.hs ./
RUN cabal update && cabal build

# Pre-fetch SuperDirt + its sample library (Dirt-Samples) as a Quark so no
# job pays that download on first boot.
COPY --chown=render:render container-src/install-superdirt.scd /tmp/install-superdirt.scd
RUN QT_QPA_PLATFORM=offscreen timeout 300 sclang /tmp/install-superdirt.scd

USER root
COPY container-src/render.sh /opt/render.sh
COPY container-src/render-inner.sh /opt/render-inner.sh
RUN chmod +x /opt/render.sh /opt/render-inner.sh

# computerd defaults: HTTP+WS on :8080, FUSE mount on MOUNT_POINT.
# FUSE_MOUNT=auto picks real FUSE on Cloudflare Containers (where /dev/fuse
# is exposed) and the userspace shim under `wrangler dev`.
ENV PORT=8080
ENV MOUNT_POINT=/workspace
ENV FUSE_MOUNT=auto
EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/computerd"]

# A drop-in replacement for cardanosolutions/cardano-node-ogmios, built on the
# official cardano-node image.
#
# Binary layout matches the image it replaces, so docker-compose entrypoints
# need no changes:
#   /usr/local/bin/cardano-node
#   /usr/local/bin/cardano-cli
#   /bin/ogmios
#
# Everything is x86-64, matching the cardanosolutions image this replaces. On
# Apple Silicon all three binaries run under emulation, exactly as before.
#
# Build context is the REPO ROOT (not docker/), so the custom node binary in
# bin/ can be copied in. Build with:
#
#   docker build --platform linux/amd64 \
#     -t cardano-devnet/cardano-node-ogmios:custom -f docker/Dockerfile .
#
# NODE_VARIANT=default swaps the custom node back out for the stock upstream
# one, should you ever need to compare against it.

ARG CARDANO_NODE_VERSION=11.1.1
ARG OGMIOS_VERSION=7.0.0
ARG NODE_VARIANT=custom

FROM --platform=$BUILDPLATFORM alpine:3.20 AS ogmios-fetch
ARG OGMIOS_VERSION
ARG TARGETARCH
RUN apk add --no-cache curl unzip \
 && case "$TARGETARCH" in \
      amd64) OGMIOS_ARCH=x86_64 ;; \
      arm64) OGMIOS_ARCH=aarch64 ;; \
      *) echo "unsupported TARGETARCH=$TARGETARCH" >&2; exit 1 ;; \
    esac \
 && curl -fsSL -o /tmp/ogmios.zip \
      "https://github.com/CardanoSolutions/ogmios/releases/download/v${OGMIOS_VERSION}/ogmios-v${OGMIOS_VERSION}-${OGMIOS_ARCH}-linux.zip" \
 && unzip -q /tmp/ogmios.zip -d /tmp/ogmios \
 && install -m 0755 /tmp/ogmios/bin/ogmios /ogmios


# ---- base: stock node + cli from upstream, plus ogmios -----------------------
FROM ghcr.io/intersectmbo/cardano-node:${CARDANO_NODE_VERSION} AS node-default
COPY --from=ogmios-fetch /ogmios /bin/ogmios


# ---- custom: overlay a locally-built cardano-node ---------------------------
# The custom binary is a Nix build that is dynamically linked against an absolute
# /nix/store closure (glibc, libsodium-vrf, blst, secp256k1, liburing, snappy,
# numactl, gmp, libffi, zlib, gcc-lib). Every one of those store paths is already
# present in the upstream amd64 image -- the fork was built against the same
# nixpkgs pin -- so no extra libraries need shipping.
FROM node-default AS node-custom
COPY --chmod=0755 bin/cardano-node /usr/local/bin/cardano-node


FROM node-${NODE_VARIANT}
ARG CARDANO_NODE_VERSION
ARG OGMIOS_VERSION

LABEL name="cardano-node-ogmios" \
      description="cardano-node ${CARDANO_NODE_VERSION} + cardano-cli + ogmios ${OGMIOS_VERSION}"

EXPOSE 1337 3000 12788 12798

HEALTHCHECK --interval=10s --timeout=5s --retries=1 \
  CMD /bin/ogmios health-check

STOPSIGNAL SIGINT

# No default entrypoint: docker-compose selects cardano-node / cardano-cli /
# ogmios per service, the same way it did with the upstream image.
ENTRYPOINT []
CMD ["/bin/sh"]

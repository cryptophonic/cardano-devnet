#!/bin/sh

if [ ! -d $HYDRA_ROOT/network ]; then
  mkdir -p $HYDRA_ROOT/network
  cp $HYDRA_ROOT/protocol-parameters.json $HYDRA_ROOT/network
fi

hydra-node publish-scripts \
  --testnet-magic 42 \
  --node-socket $CARDANO_NODE_SOCKET_PATH \
  --cardano-signing-key $CARDANO_ASSETS_PATH/keys/faucet.skey > $HYDRA_ROOT/network/scripts-utxo.txt

#!/bin/sh

if [ ! -d $HYDRA_ROOT/network ]; then
  mkdir -p $HYDRA_ROOT/network
fi

# Remove any old node configurations
rm -rf $HYDRA_ROOT/network/node-*

peers=$HYDRA_ROOT/network/peers
rm -f $peers

cp $HYDRA_ROOT/protocol-parameters.json $HYDRA_ROOT/network

count=10
for name in "$@"; do
  nodedir="$HYDRA_ROOT/network/node-$name"
  ip=172.16.0.$count
  mkdir -p $nodedir
  count=$((count+10))

  # credentials
  cd $nodedir
  if [ ! -f $CARDANO_ASSETS_PATH/keys/$name.skey ]; then
    key-gen $name
  fi
  cp $CARDANO_ASSETS_PATH/keys/$name.vkey ./funds.vk
  cp $CARDANO_ASSETS_PATH/keys/$name.skey ./funds.sk
  cp $CARDANO_ASSETS_PATH/addr/$name.addr ./funds.addr

  cardano-cli address key-gen --verification-key-file ./node.vk --signing-key-file ./node.sk
  cardano-cli address build --verification-key-file ./node.vk --out-file ./node.addr
  hydra-node gen-hydra-key --output-file ./hydra
  fund $(cat ./funds.addr) 1000
  fund $(cat ./node.addr) 30
  cd - > /dev/null

  echo $name $ip >> $peers
done


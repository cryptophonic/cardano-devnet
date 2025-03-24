# Always Succeeds script

This directory contains a plutus v3 smart contract that can always be spent (it always returns True). To run the example, follow these steps:

1. In a separate terminal window, start the devnet, monitor, indexer and provider.

```
$ start-cardano-devnet -mip 
```

2.  Build the smart contract

```
$ cd aiken; aiken build; cd ..
```

3.  Lock 5 ADA into the smart contract from a random address

```
$ node seed-utxo.mjs
```

4.  Claim the locked funds with a named wallet, "alice" (or whatever alias name you prefer - the fund script will create the wallet if it doesn't already exist)

```
$ fund alice 100
$ node unlock-script-funds.mjs alice
$ utxos alice
```

You should see slightly less that 105 ADA in alice's address. This is because some of the funds were used to pay gas fees when claiming the smart contract locked funds.

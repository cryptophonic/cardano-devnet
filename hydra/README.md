# Hydra instructions

Running a hydra head under the cardano-devnet project is easy:

## Run the layer 1 cardano devnet

1. Start cardano-devnet as normal, with a 2 second blocktime:

```
$ start-cardano-devnet -m 2
```

## Publish the hydra scripts

2. In a second terminal window, publish the hydra scripts. Everything runs under docker, so there are no binaries to install.

```
$ cd hydra
$ ./publish_scripts.sh
```

![image](https://github.com/user-attachments/assets/1f145b39-23f9-40aa-af4d-6ccad6ec13d0)

*sample publish transaction*
 
Wait for the publish transaction to confirm on the layer 1 terminal.

## Set up the hydra participants

3. Setup a hydra head, naming up to five participants as you want. This example is for two participants:

```
$ ./setup-peers.sh alice bob
```

The hydra head runs on an internal docker network, 172.16.0.x.  Each node is assigned an IP address on this network, incrementing by 10, i.e. alice will be at 172.16.0.10, bob at 172.16.0.20, etc.

## Open the hydra head

4. In N number of separate terminal windows, run a node + hydra-tui (the user interface). If you have 3 participants in the head, you'll need 3 windows:

Terminal 1:
```
$ ./start-hydra-node.sh alice
```

Terminal 2:
```
$ ./start-hydra-node.sh bob
```

In one of the terminals, initialize the head by pressing the 'I' key.  Only one participant needs to initialize the head.  Wait for the transaction to confirm in the original terminal window
running the layer 1 network.

In each terminal press the 'C' key and choose which tx's you want to move into the head for each party by hitting the space bar to mark the transaction with an 'X'.  Hit 'Enter' to confirm these and 
wait for the transactions get confirmed in the layer 1 for each party. 

![image](https://github.com/user-attachments/assets/c240f3c7-d0c2-4109-aa24-2b83111e729d)

*confirming which transaction to include*

The head is now open!

## Close the hydra head

To close the head, type 'C' and 'Enter' to confirm closing the head.  There will be a 2-minute contestation period that must count down, before you can fanout the head by typing 'F' in one 
of the parties windows.  This will cause the final tx's to post to the layer 1 network in the orignal terminal.  Congratulations on running your first local hydra head!

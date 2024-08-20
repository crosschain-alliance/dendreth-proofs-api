export default [
  {
    inputs: [
      {
        internalType: 'bytes32',
        name: '_optimisticHeaderRoot',
        type: 'bytes32'
      },
      {
        internalType: 'uint256',
        name: '_optimisticHeaderSlot',
        type: 'uint256'
      },
      {
        internalType: 'bytes32',
        name: '_finalizedHeaderRoot',
        type: 'bytes32'
      },
      {
        internalType: 'bytes32',
        name: '_executionStateRoot',
        type: 'bytes32'
      },
      {
        internalType: 'bytes32',
        name: '_domain',
        type: 'bytes32'
      }
    ],
    stateMutability: 'nonpayable',
    type: 'constructor'
  },
  {
    inputs: [],
    name: 'currentIndex',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256'
      }
    ],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'executionStateRoot',
    outputs: [
      {
        internalType: 'bytes32',
        name: '',
        type: 'bytes32'
      }
    ],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256'
      }
    ],
    name: 'executionStateRoots',
    outputs: [
      {
        internalType: 'bytes32',
        name: '',
        type: 'bytes32'
      }
    ],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'finalizedHeaderRoot',
    outputs: [
      {
        internalType: 'bytes32',
        name: '',
        type: 'bytes32'
      }
    ],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256'
      }
    ],
    name: 'finalizedHeaders',
    outputs: [
      {
        internalType: 'bytes32',
        name: '',
        type: 'bytes32'
      }
    ],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: 'bytes32',
            name: 'attestedHeaderRoot',
            type: 'bytes32'
          },
          {
            internalType: 'uint256',
            name: 'attestedHeaderSlot',
            type: 'uint256'
          },
          {
            internalType: 'bytes32',
            name: 'finalizedHeaderRoot',
            type: 'bytes32'
          },
          {
            internalType: 'bytes32',
            name: 'finalizedExecutionStateRoot',
            type: 'bytes32'
          },
          {
            internalType: 'uint256[2]',
            name: 'a',
            type: 'uint256[2]'
          },
          {
            internalType: 'uint256[2][2]',
            name: 'b',
            type: 'uint256[2][2]'
          },
          {
            internalType: 'uint256[2]',
            name: 'c',
            type: 'uint256[2]'
          }
        ],
        internalType: 'struct BeaconLightClient.LightClientUpdate',
        name: 'update',
        type: 'tuple'
      }
    ],
    name: 'light_client_update',
    outputs: [],
    stateMutability: 'payable',
    type: 'function'
  },
  {
    inputs: [],
    name: 'optimisticHeaderRoot',
    outputs: [
      {
        internalType: 'bytes32',
        name: '',
        type: 'bytes32'
      }
    ],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'optimisticHeaderSlot',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256'
      }
    ],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256'
      }
    ],
    name: 'optimisticHeaders',
    outputs: [
      {
        internalType: 'bytes32',
        name: '',
        type: 'bytes32'
      }
    ],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256'
      }
    ],
    name: 'optimisticSlots',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256'
      }
    ],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [
      {
        internalType: 'uint256[2]',
        name: 'a',
        type: 'uint256[2]'
      },
      {
        internalType: 'uint256[2][2]',
        name: 'b',
        type: 'uint256[2][2]'
      },
      {
        internalType: 'uint256[2]',
        name: 'c',
        type: 'uint256[2]'
      },
      {
        internalType: 'uint256[2]',
        name: 'input',
        type: 'uint256[2]'
      }
    ],
    name: 'verifyProof',
    outputs: [
      {
        internalType: 'bool',
        name: 'r',
        type: 'bool'
      }
    ],
    stateMutability: 'view',
    type: 'function'
  }
]

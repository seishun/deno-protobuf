const plugin = require("google-protobuf/google/protobuf/compiler/plugin_pb");
const descriptorpb = require("google-protobuf/google/protobuf/descriptor_pb");
const fs = require("fs");
const ts = require("typescript");

function createImport(identifier, moduleSpecifier) {
  return ts.createImportDeclaration(
    undefined,
    undefined,
    ts.createImportClause(ts.createIdentifier(identifier)),
    ts.createLiteral(moduleSpecifier)
  );
}

function createToObject(rootDescriptor, messageDescriptor) {
  const properties = [];

  for (const fd of messageDescriptor.getFieldList()) {
    let propertyAccessExpression  = ts.createPropertyAccess(ts.createThis(), fd.getName());

    if ( isMessage(fd) ) {
      if(isRepeated(fd)) {
          const arrowFunc = ts.createArrowFunction(
            undefined,
            undefined,
            [
              ts.createParameter(
                  undefined,
                  undefined,
                  undefined,
                  "item",
                  undefined,
                  ts.createTypeReferenceNode(ts.createIdentifier(
                      getTypeName(
                          fd,
                          rootDescriptor.getPackage()
                      )
                  ), undefined)
              )
            ],
            undefined,
            ts.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
            ts.createCall(
                ts.createPropertyAccess(
                    ts.createIdentifier("item"),
                    "toObject"
                ),
                undefined,
                null
            )
          )
          propertyAccessExpression = ts.createCall(
            ts.createPropertyAccess(
                propertyAccessExpression,
                "map",
            ),
            undefined,
            [arrowFunc]
          )
      } else {
        propertyAccessExpression = ts.createBinary(
            propertyAccessExpression,
            ts.SyntaxKind.AmpersandAmpersandToken,
            ts.createCall(
                ts.createPropertyAccess(
                    propertyAccessExpression,
                    "toObject"
                )
            )
        )
      }
    }
    properties.push(
      ts.createPropertyAssignment(
        ts.createIdentifier(fd.getName()),
        propertyAccessExpression
      )
    )
  }

  return ts.createMethod(
    undefined,
    undefined,
    undefined,
    ts.createIdentifier("toObject"),
    undefined,
    undefined,
    undefined,
    undefined,
    ts.createBlock(
      [
        ts.createReturn(
          ts.createObjectLiteral(properties, true)
        )
      ],
      true
    )
  );
}

function createNamespace(packageName, statements) {
  const identifiers = String(packageName).split(".");

  statements = ts.createModuleBlock(statements);

  for (let i = identifiers.length - 1; i >= 0; i--) {
    statements = ts.createModuleDeclaration(
      undefined,
      [ts.createModifier(ts.SyntaxKind.ExportKeyword)],
      ts.createIdentifier(identifiers[i]),
      statements,
      ts.NodeFlags.Namespace
    );
  }

  return statements;
}

function createTypeLiteral(rootDescriptor, messageDescriptor) {
  const members = [];

  for (const fieldDescriptor of messageDescriptor.getFieldList()) {
    // TODO: Check if the field is optional
    members.push(
      ts.createPropertySignature(
        undefined, 
        fieldDescriptor.getName(), 
        ts.createToken(ts.SyntaxKind.QuestionToken),
        wrapRepeatedType(
          getType(fieldDescriptor, rootDescriptor.getPackage()),
          fieldDescriptor
        ),
        undefined
      )
    )
  }
  return ts.createTypeLiteralNode(members)
}

function createConstructor(accessorIdentifier) {
  const statements = [];

  const kernelIdentifier = ts.createIdentifier("kernel");
  const typeNode = ts.createTypeReferenceNode(ts.createIdentifier("Kernel"), undefined) /* Kernel */;


  statements.push(
    ts.createStatement(
      ts.createBinary(
        ts.createPropertyAccess(ts.createThis(), accessorIdentifier),
        ts.SyntaxKind.EqualsToken,
        kernelIdentifier
      )
    )
  );

  return ts.createConstructor(
    undefined,
    ts.createModifiersFromModifierFlags(ts.ModifierFlags.Private),
    [
      ts.createParameter(
        undefined,
        undefined,
        undefined,
        kernelIdentifier,
        undefined,
        typeNode
      )
    ],
    ts.createBlock(statements, true)
  );
}

/**
 * Returns the internalGetKernel method for the message class
 */
function createInternalGetKernel(accessorIdentifier) {
  return ts.createMethod(
    undefined,
    undefined,
    undefined,
    ts.createIdentifier("internalGetKernel"),
    undefined,
    undefined,
    [],
    ts.createTypeReferenceNode(ts.createIdentifier("Kernel"), undefined),
    ts.createBlock(
      [
        ts.createReturn(
          ts.createPropertyAccess(ts.createThis(), accessorIdentifier),
          undefined,
          []
        )
      ],
      true
    )
  )
}

function wrapRepeatedType(type, fieldDescriptor) {
  if (isRepeated(fieldDescriptor)) {
    type = ts.createArrayTypeNode(type);
  }

  return type;
}

function getType(fieldDescriptor, packageName) {
  switch (fieldDescriptor.getType()) {
    case descriptorpb.FieldDescriptorProto.Type.TYPE_DOUBLE:
    case descriptorpb.FieldDescriptorProto.Type.TYPE_FLOAT:
    case descriptorpb.FieldDescriptorProto.Type.TYPE_INT32:
    case descriptorpb.FieldDescriptorProto.Type.TYPE_UINT32:
    case descriptorpb.FieldDescriptorProto.Type.TYPE_SINT32:
    case descriptorpb.FieldDescriptorProto.Type.TYPE_FIXED32:
    case descriptorpb.FieldDescriptorProto.Type.TYPE_SFIXED32:
      return ts.createIdentifier("number");
    case descriptorpb.FieldDescriptorProto.Type.TYPE_INT64:
    case descriptorpb.FieldDescriptorProto.Type.TYPE_UINT64:
    case descriptorpb.FieldDescriptorProto.Type.TYPE_SINT64:
    case descriptorpb.FieldDescriptorProto.Type.TYPE_FIXED64:
    case descriptorpb.FieldDescriptorProto.Type.TYPE_SFIXED64:
      return ts.createIdentifier("Int64");
    case descriptorpb.FieldDescriptorProto.Type.TYPE_STRING:
      return ts.createIdentifier("string");
    case descriptorpb.FieldDescriptorProto.Type.TYPE_BOOL:
      return ts.createIdentifier("boolean");
    case descriptorpb.FieldDescriptorProto.Type.TYPE_BYTES:
      return ts.createIdentifier("Uint8Array");
    case descriptorpb.FieldDescriptorProto.Type.TYPE_MESSAGE:
    case descriptorpb.FieldDescriptorProto.Type.TYPE_ENUM:
      return ts.createIdentifier(getTypeName(fieldDescriptor, packageName));
    default:
      throw new Error("Unhandled type " + fieldDescriptor.getType());
  }
}

function getTypeName(fieldDescriptor, packageName) {
  if (packageName == undefined) {
    throw new TypeError();
  }

  return normalizeTypeName(fieldDescriptor.getTypeName(), packageName);
}

function normalizeTypeName(name, packageName) {
  return (packageName ? name.replace(`${packageName}.`, "") : name).replace(
    /^\./,
    ""
  );
}

function isRepeated(fieldDescriptor) {
  return (
    fieldDescriptor.getLabel() ==
    descriptorpb.FieldDescriptorProto.Label.LABEL_REPEATED
  );
}

function isMessage(fieldDescriptor) {
  return (
    fieldDescriptor.getType() ==
    descriptorpb.FieldDescriptorProto.Type.TYPE_MESSAGE
  );
}

function isPackageable(fieldDescriptor) {
  const type = fieldDescriptor.getType();
  return (
    isRepeated(fieldDescriptor) &&
    type != descriptorpb.FieldDescriptorProto.Type.TYPE_STRING &&
    type != descriptorpb.FieldDescriptorProto.Type.TYPE_GROUP &&
    type != descriptorpb.FieldDescriptorProto.Type.TYPE_MESSAGE &&
    type != descriptorpb.FieldDescriptorProto.Type.TYPE_BYTES
  );
}

function isPacked(fieldDescriptor, descriptor) {
  if (!isPackageable(fieldDescriptor)) {
    return false;
  }
  const options = fieldDescriptor.getOptions();
  if (descriptor.getSyntax() == "proto2") {
    return options && options.getPacked();
  }

  return options == null || !options.hasPacked() || options.getPacked();
}

function toBinaryMethodName(fieldDescriptor, descriptor, isSetter = true) {
  const typeNames = Object.keys(descriptorpb.FieldDescriptorProto.Type).map(n =>
    n.replace("TYPE_", "")
  );

  let typeName = typeNames[fieldDescriptor.getType() - 1].toLowerCase();
  typeName = typeName.charAt(0).toUpperCase() + typeName.slice(1);
  return isRepeated(fieldDescriptor)
    ? isSetter && isPackageable(fieldDescriptor)
      ? isPacked(fieldDescriptor, descriptor)
        ? `Packed${typeName}Iterable`
        : `Unpacked${typeName}Iterable`
      : `Repeated${typeName}Iterable`
    : isSetter
      ? typeName
      : `${typeName}WithDefault`;
}

// Returns a get accessor for the field
function createGetter(rootDescriptor, fieldDescriptor, accessorIdentifier) {
  let type = wrapRepeatedType(
    getType(fieldDescriptor, rootDescriptor.getPackage()),
    fieldDescriptor
  );
  return  ts.createGetAccessor(
    undefined,
    undefined,
    fieldDescriptor.getName(),
    undefined,
    type,
    ts.createBlock(
      [
        ts.createReturn(
          createGetterCall(
            rootDescriptor,
            fieldDescriptor,
            accessorIdentifier,
            type,
            rootDescriptor.getPackage()
          )
        )
      ],
      true
    )
  )
}

// Returns the inner logic of the field accessor.
function createGetterCall(rootDescriptor, fieldDescriptor, accessorIdentifier, type, packageName) {
  let calle = `get${toBinaryMethodName(
    fieldDescriptor,
    rootDescriptor,
    false
  )}`;

  let args = [
    ts.createNumericLiteral(fieldDescriptor.getNumber().toString()),
  ];

  if (isMessage(fieldDescriptor)) {
    calle = isRepeated(fieldDescriptor)
      ? ts.createIdentifier("getRepeatedMessageIterable")
      : ts.createIdentifier("getMessage");
    args.push(ts.createPropertyAccess(
      ts.createIdentifier(getTypeName(fieldDescriptor, packageName)),
      "instanceCreator"
    ));
  }

  return ts.createAsExpression(
    ts.createCall(
      ts.createPropertyAccess(
        ts.createPropertyAccess(ts.createThis(), accessorIdentifier),
        calle
      ),
      undefined,
      args
    ),
    type
  );
}

// Returns a set accessor for the field
function createSetter(rootDescriptor, fieldDescriptor, accessorIdentifier) {
  let type = wrapRepeatedType(
    getType(fieldDescriptor, rootDescriptor.getPackage()),
    fieldDescriptor
  );
  const paramIdentifier = ts.createIdentifier("value");
  return ts.createSetAccessor(
    undefined,
    undefined,
    fieldDescriptor.getName(),
    [
      ts.createParameter(
        undefined,
        undefined,
        undefined,
        paramIdentifier,
        undefined,
        type
      )
    ],
    ts.createBlock(
      [
        ts.createStatement(
          ts.createCall(
            ts.createPropertyAccess(
              ts.createPropertyAccess(ts.createThis(), accessorIdentifier),
              // isMessage(fieldDescriptor)
              `set${toBinaryMethodName(
                fieldDescriptor,
                rootDescriptor,
                true
              )}`
            ),
            undefined,
            [
              ts.createNumericLiteral(
                fieldDescriptor.getNumber().toString()
              ),
              paramIdentifier
            ]
          )
        )
      ],
      true
    )
  )
}

/**
 * Returns the serialize method for the message class 
 */
function createSerialize(accessorIdentifier) {
  return ts.createMethod(
    undefined,
    undefined,
    undefined,
    ts.createIdentifier("serialize"),
    undefined,
    undefined,
    [],
    ts.createTypeReferenceNode(ts.createIdentifier("ArrayBuffer"), undefined),
    ts.createBlock(
      [
        ts.createReturn(
          ts.createCall(
            ts.createPropertyAccess(
              ts.createPropertyAccess(ts.createThis(), accessorIdentifier),
              "serialize"
            ),
            undefined,
            []
          )
        )
      ],
      true
    )
  )
}


/**
 * Returns the instanceCreator method for the message class
 */
function createInstanceCreator(messageDescriptor) {
  const kernelIdentifier = ts.createIdentifier("kernel");
  const typeNode = ts.createTypeReferenceNode(ts.createIdentifier("Kernel"), undefined) /* Kernel */;

  return  ts.createMethod(
    undefined,
    [ts.createModifier(ts.SyntaxKind.StaticKeyword)],
    undefined,
    ts.createIdentifier("instanceCreator"),
    undefined,
    [],
    [
      ts.createParameter(
        undefined,
        undefined,
        undefined,
        kernelIdentifier,
        undefined,
        typeNode
      )
    ],
    ts.createTypeReferenceNode(messageDescriptor.getName(), undefined),
    ts.createBlock(
      [
        ts.createReturn(ts.createNew(
          ts.createIdentifier(messageDescriptor.getName()),
          undefined,
          [kernelIdentifier]
        ))
      ],
      true
    )
  )
}


/**
 * Returns the createEmpty method for the message class
 */
function createCreateEmpty(messageDescriptor) {
  return  ts.createMethod(
    undefined,
    [ts.createModifier(ts.SyntaxKind.StaticKeyword)],
    undefined,
    ts.createIdentifier("createEmpty"),
    undefined,
    undefined,
    [],
    ts.createTypeReferenceNode(messageDescriptor.getName(), undefined),
    ts.createBlock(
      [
        ts.createReturn(ts.createNew(
          ts.createIdentifier(messageDescriptor.getName()),
          undefined,
          [ts.createCall(ts.createPropertyAccess(ts.createIdentifier("Kernel"), "createEmpty"))]
        ))
      ],
      true
    )
  )
}


/**
 * Returns the deserialize method for the message class
 */
function createDeserialize(messageDescriptor) {
  return  ts.createMethod(
    undefined,
    [ts.createModifier(ts.SyntaxKind.StaticKeyword)],
    undefined,
    ts.createIdentifier("deserialize"),
    undefined,
    undefined,
    [
      ts.createParameter(
        undefined,
        undefined,
        undefined,
        ts.createIdentifier("bytes"),
        undefined,
        ts.createTypeReferenceNode(ts.createIdentifier("ArrayBuffer"), undefined)
      )
    ],
    ts.createTypeReferenceNode(messageDescriptor.getName(), undefined),
    ts.createBlock(
      [
        ts.createReturn(ts.createNew(
          ts.createIdentifier(messageDescriptor.getName()),
          undefined,
          [
            ts.createCall(
              ts.createPropertyAccess(ts.createIdentifier("Kernel"), "fromArrayBuffer"),
              undefined,
              [
                ts.createIdentifier("bytes")
              ]
            )
          ]
        ))
      ],
      true
    )
  )
}
 
// Returns a class for the message descriptor
function createMessage(rootDescriptor, messageDescriptor) {
  const accessorIdentifier = ts.createPrivateIdentifier("#accessor");

  const members = [];

  // Create accessor property
  members.push(ts.createProperty(undefined, undefined, accessorIdentifier, undefined, ts.createIdentifier("Kernel")));

  // Create constructor
  members.push(createConstructor(accessorIdentifier));

  // Create internalGetKernel method
  members.push(createInternalGetKernel(accessorIdentifier));


  // Create getter and setters
  for (const fieldDescriptor of messageDescriptor.getFieldList()) {
    members.push(createGetter(rootDescriptor, fieldDescriptor, accessorIdentifier));
    members.push(createSetter(rootDescriptor, fieldDescriptor, accessorIdentifier));
  }


  // Create toObject method
  members.push(createToObject(rootDescriptor, messageDescriptor));

  // Create serialize  method
  members.push(createSerialize(accessorIdentifier));

  // Create instanceCreator method
  members.push(createInstanceCreator(messageDescriptor));

  // Create createEmpty method
  members.push(createCreateEmpty(messageDescriptor));

  // Create deserialize method
  members.push(createDeserialize(messageDescriptor));

  // Create message class
  return ts.createClassDeclaration(
    undefined,
    [ts.createModifier(ts.SyntaxKind.ExportKeyword)],
    ts.createIdentifier(messageDescriptor.getName()),
    undefined,
    [],
    members
  );
}

// Returns a enum for the enum descriptor
function createEnum(enumDescriptor) {
  return ts.createEnumDeclaration(
    undefined,
    [ts.createModifier(ts.SyntaxKind.ExportKeyword)],
    ts.createIdentifier(enumDescriptor.getName()),
    enumDescriptor.getValueList().map(valueDescriptor => {
      return ts.createEnumMember(
        valueDescriptor.getName(),
        ts.createNumericLiteral(valueDescriptor.getNumber().toString())
      );
    })
  );
}


function getRPCOutputType(rootDescriptor, methodDescriptor) {
  return normalizeTypeName(
    methodDescriptor.getOutputType(),
    rootDescriptor.getPackage()
  );
}

function getRPCInputType(rootDescriptor, methodDescriptor) {
  return  normalizeTypeName(
    methodDescriptor.getInputType(),
    rootDescriptor.getPackage()
  );
}

function getRPCPath(rootDescriptor, serviceDescriptor, methodDescriptor) {
  return `/${[
    rootDescriptor.getPackage(),
    serviceDescriptor.getName(),
    methodDescriptor.getName()
  ]
    .filter(Boolean)
    .join("/")}`
}

function isUnaryRPC(methodDescriptor) {
  return methodDescriptor.getServerStreaming() == false && methodDescriptor.getClientStreaming() == false
}

// Returns grpc-node compatible service description
function createService(rootDescriptor, serviceDescriptor) {
  return ts.createVariableStatement(
    [
      ts.createModifier(ts.SyntaxKind.ExportKeyword),
    ],
    [
      ts.createVariableDeclaration(
        ts.createIdentifier(serviceDescriptor.getName()),
        undefined,
        ts.createObjectLiteral(
          serviceDescriptor.getMethodList().map(methodDescriptor => {
            return ts.createPropertyAssignment(
              methodDescriptor.getName(),
              ts.createObjectLiteral(
                [
                  ts.createPropertyAssignment(
                    "path",
                    ts.createStringLiteral(getRPCPath(rootDescriptor, serviceDescriptor, methodDescriptor))
                  ),
                  ts.createPropertyAssignment(
                    "requestStream",
                    methodDescriptor.getClientStreaming()
                      ? ts.createTrue()
                      : ts.createFalse()
                  ),
                  ts.createPropertyAssignment(
                    "responseStream",
                    methodDescriptor.getServerStreaming()
                      ? ts.createTrue()
                      : ts.createFalse()
                  ),
                  ts.createPropertyAssignment(
                    "requestType",
                    ts.createIdentifier(
                      methodDescriptor.getInputType().slice(1)
                    )
                  ),
                  ts.createPropertyAssignment(
                    "responseType",
                    ts.createIdentifier(
                      methodDescriptor.getOutputType().slice(1)
                    )
                  ),
                  ts.createPropertyAssignment(
                    "requestSerialize",
                    ts.createArrowFunction(
                      undefined,
                      undefined,
                      [
                        ts.createParameter(
                          undefined,
                          undefined,
                          undefined,
                          "message",
                          undefined,
                          ts.createTypeReferenceNode(
                            ts.createIdentifier(getRPCInputType(rootDescriptor, methodDescriptor)), 
                            undefined
                          )
                        )
                      ],
                      undefined,
                      ts.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
                      ts.createCall(
                        ts.createPropertyAccess(
                          ts.createIdentifier("Buffer"),
                          "from"
                        ),
                        undefined,
                        [
                          ts.createCall(
                            ts.createPropertyAccess(
                              ts.createIdentifier("message"),
                              "serialize"
                            ),
                            undefined,
                            undefined
                          )
                        ]
                      )
                    )
                  ),
                  ts.createPropertyAssignment(
                    "requestDeserialize",
                    ts.createArrowFunction(
                      undefined,
                      undefined,
                      [
                        ts.createParameter(
                          undefined,
                          undefined,
                          undefined,
                          "bytes",
                          undefined,
                          ts.createTypeReferenceNode(
                            ts.createIdentifier("Buffer"),
                            undefined
                          )
                        )
                      ],
                      undefined,
                      ts.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
                      ts.createCall(
                        ts.createPropertyAccess(
                          ts.createIdentifier(getRPCInputType(rootDescriptor, methodDescriptor)),
                          "deserialize"
                        ),
                        undefined,
                        [
                          ts.createNew(
                            ts.createIdentifier("Uint8Array"),
                            undefined,
                            [ts.createIdentifier("bytes")]
                          )
                        ]
                      )
                    )
                  ),
                  ts.createPropertyAssignment(
                    "responseSerialize",
                    ts.createArrowFunction(
                      undefined,
                      undefined,
                      [
                        ts.createParameter(
                          undefined,
                          undefined,
                          undefined,
                          "message",
                          undefined,
                          ts.createTypeReferenceNode(
                            ts.createIdentifier(
                              getRPCOutputType(rootDescriptor, methodDescriptor)
                            ),
                            undefined
                          )
                        )
                      ],
                      undefined,
                      ts.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
                      ts.createCall(
                        ts.createPropertyAccess(
                          ts.createIdentifier("Buffer"),
                          "from"
                        ),
                        undefined,
                        [
                          ts.createCall(
                            ts.createPropertyAccess(
                              ts.createIdentifier("message"),
                              "serialize"
                            ),
                            undefined,
                            []
                          )
                        ]
                      )
                    )
                  ),
                  ts.createPropertyAssignment(
                    "responseDeserialize",
                    ts.createArrowFunction(
                      undefined,
                      undefined,
                      [
                        ts.createParameter(
                          undefined,
                          undefined,
                          undefined,
                          "bytes",
                          undefined,
                          ts.createTypeReferenceNode(ts.createIdentifier("Buffer"), undefined)
                        )
                      ],
                      undefined,
                      ts.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
                      ts.createCall(
                        ts.createPropertyAccess(
                          ts.createIdentifier(getRPCOutputType(rootDescriptor, methodDescriptor)),
                          "deserialize"
                        ),
                        undefined,
                        [
                          ts.createNew(
                            ts.createIdentifier("Uint8Array"),
                            undefined,
                            [ts.createIdentifier("bytes")]
                          )
                        ]
                      )
                    )
                  )
                ],
                true
              )
            );
          }),
          true
        )
      )
    ]
  );
}

// Returns grpc-node compatible unary client method
function createUnaryServiceClientMethod(rootDescriptor, methodDescriptor, grpcIdentifier) {
  const responseType = ts.createTypeReferenceNode(
    getRPCOutputType(rootDescriptor, methodDescriptor)
  );
  const requestType = ts.createTypeReferenceNode(
    getRPCInputType(rootDescriptor, methodDescriptor)
  )

  const metadataType = ts.createQualifiedName(grpcIdentifier, "Metadata");

  const errorType = ts.createQualifiedName(grpcIdentifier, "ServiceError");

  const returnType = ts.createTypeReferenceNode(
    "Promise", 
    [
      responseType
    ]
  )
 
  const rpcName = methodDescriptor.getName();

  const promiseBody = ts.createCall(
    ts.createElementAccess(ts.createSuper(), ts.createStringLiteral(rpcName)),
    undefined,
    [
      ts.createIdentifier("request"),
      ts.createIdentifier("metadata"),
      ts.createArrowFunction(
        undefined,
        undefined,
        [
          ts.createParameter(
            undefined,
            undefined,
            undefined,
            'error',
            undefined,
            errorType
          ),
          ts.createParameter(
            undefined,
            undefined,
            undefined,
            'response',
            undefined,
            responseType
          )
        ],
        undefined,
        ts.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        ts.createBlock([
          ts.createIf(
            ts.createIdentifier('error'),
            ts.createBlock([
              ts.createStatement(
                ts.createCall(
                  ts.createIdentifier('reject'),
                  undefined,
                  [
                    ts.createIdentifier('error')
                  ]
                )
              )
            ]),
            ts.createBlock([
              ts.createStatement(
                ts.createCall(
                  ts.createIdentifier('resolve'),
                  undefined,
                  [
                    ts.createIdentifier('response')
                  ]
                )
              )
            ])
          )
        ], true)
      )
    ]
  )

  return ts.createMethod(
    undefined,
    undefined,
    undefined,
    rpcName,
    undefined,
    undefined,
    [
      ts.createParameter(
        undefined,
        undefined,
        undefined,
        "request",
        undefined,
        requestType
      ),
      ts.createParameter(
        undefined,
        undefined,
        undefined,
        "metadata",
        ts.createToken(ts.SyntaxKind.QuestionToken),
        metadataType
      ),
    ],
    returnType,
    ts.createBlock([
      ts.createReturn(
        ts.createNew(
          ts.createIdentifier("Promise"),
          undefined,
          [
            ts.createArrowFunction(
              undefined,
              undefined,
              [
                ts.createParameter(
                  undefined,
                  undefined,
                  undefined,
                  "resolve"
                ),
                ts.createParameter(
                  undefined,
                  undefined,
                  undefined,
                  "reject"
                )
              ],
              undefined,
              ts.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
              promiseBody
            )
          ]
        )
      )
    ], true)
  )
}

// Returns grpc-node compatible service client.
function createServiceClient(rootDescriptor, serviceDescriptor, grpcIdentifier) {
  const members = [
    ts.createConstructor(
      undefined, 
      undefined,
      [
        ts.createParameter(undefined, undefined, undefined, "address", undefined, ts.createKeywordTypeNode(ts.SyntaxKind.StringKeyword)),
        ts.createParameter(
          undefined, 
          undefined, 
          undefined, 
          "credentials", 
          undefined, 
          ts.createTypeReferenceNode(ts.createQualifiedName(grpcIdentifier, "ChannelCredentials"))
        )
      ], 

      ts.createBlock([
        ts.createCall(ts.createSuper(), undefined, [ts.createIdentifier("address"), ts.createIdentifier("credentials")])
      ], true)
    )
  ]

  for (const methodDescriptor of serviceDescriptor.getMethodList()) {
    if ( !isUnaryRPC(methodDescriptor) || !process.env.EXPERIMENTAL_FEATURES ) {
      continue;
    }
    members.push(
      createUnaryServiceClientMethod(rootDescriptor, methodDescriptor, grpcIdentifier)
    )
  }

  return ts.createClassDeclaration(
    undefined,
    [
      ts.createModifier(ts.SyntaxKind.ExportKeyword)
    ],
    ts.createIdentifier(`${serviceDescriptor.getName()}Client`),
    undefined,
    [
      ts.createHeritageClause(ts.SyntaxKind.ExtendsKeyword, [
        ts.createExpressionWithTypeArguments(undefined, ts.createCall(
          ts.createPropertyAccess(
            grpcIdentifier,
            "makeGenericClientConstructor"
          ),
          undefined,
          [
            ts.createIdentifier(serviceDescriptor.getName()),
            ts.createStringLiteral(serviceDescriptor.getName()),
            ts.createObjectLiteral()
          ]
        ))
      ])
    ],
    members
  )
}

function processProtoDescriptor(rootDescriptor, descriptor) {
  const statements = [];

  // Process messages
  if (descriptor.getMessageTypeList) {
    for (const messageDescriptor of descriptor.getMessageTypeList()) {
      statements.push(createMessage(rootDescriptor, messageDescriptor));

      // Process nested messages
      if (
        messageDescriptor.getNestedTypeList &&
        messageDescriptor.getNestedTypeList().length
      ) {
        const namespacedStatements = processProtoDescriptor(rootDescriptor, messageDescriptor);
        statements.push(createNamespace( messageDescriptor.getName(), namespacedStatements));
      }
    }
  }

  // Process nested messages
  if (descriptor.getNestedTypeList) {
    for (const nestedDescriptor of descriptor.getNestedTypeList()) {
      statements.push(createMessage(rootDescriptor, nestedDescriptor));
    }
  }

  // Process enums
  for (const enumDescriptor of descriptor.getEnumTypeList()) {
    statements.push(createEnum(enumDescriptor));
  }

  return statements;
}

function main() {

  const pbBuffer = fs.readFileSync(0);
  const pbVector = new Uint8Array(pbBuffer.length);
  pbVector.set(pbBuffer);
  
  const codeGenRequest = plugin.CodeGeneratorRequest.deserializeBinary(pbVector);
  const codeGenResponse = new plugin.CodeGeneratorResponse();
  
  const descriptors = codeGenRequest.getProtoFileList();
  
  for (const descriptor of descriptors) {
    const name = descriptor.getName().replace(".proto", ".ts");
    const codegenFile = new plugin.CodeGeneratorResponse.File();
  
    const sf = ts.createSourceFile(
      name,
      ``,
      ts.ScriptTarget.ES2020,
      false,
      ts.ScriptKind.TS
    );
  
    const grpcIdentifier = ts.createUniqueName("grpc");
    
    const importStatements = [];

    // Create all messages recursively
    const statements = processProtoDescriptor(descriptor, descriptor);

    if ( statements.length ) {
      importStatements.push(createImport("Kernel", "https://deno.land/x/protobuf/kernel/kernel.js"));
      importStatements.push(createImport("Int64", "https://deno.land/x/protobuf/int64.js"));
    }

    // Create all services and clients
    for (const serviceDescriptor of descriptor.getServiceList()) {
      statements.push(createService(descriptor, serviceDescriptor));
      statements.push(createServiceClient(descriptor, serviceDescriptor, grpcIdentifier))
    }

    if ( descriptor.getServiceList().length ) {
      importStatements.push(createImport(grpcIdentifier, "grpc"));
    }

  
    // Wrap statements within the namespace
    if (descriptor.hasPackage()) {
      sf.statements = ts.createNodeArray([
        ...importStatements,
        createNamespace(descriptor.getPackage(), statements)
      ]);
    } else {
      sf.statements = ts.createNodeArray([...importStatements, ...statements]);
    }
  
    codegenFile.setName(name);
    codegenFile.setContent(
      ts
        .createPrinter({
          newLine: ts.NewLineKind.LineFeed,
          omitTrailingSemicolon: true
        })
        .printFile(sf)
    );
  
    codeGenResponse.addFile(codegenFile);
  }
  
  process.stdout.write(Buffer.from(codeGenResponse.serializeBinary()));
};

main();
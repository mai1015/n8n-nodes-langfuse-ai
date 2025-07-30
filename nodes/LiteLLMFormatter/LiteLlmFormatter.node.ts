import {
    IExecuteFunctions,
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
    NodeConnectionType,
    NodeOperationError,
} from 'n8n-workflow';

export class LiteLLMFormatter implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'LiteLLM Formatter',
        name: 'liteLlmFormatter',
        icon: 'fa:exchange-alt',
        group: ['transform'],
        version: 1,
        description: 'Formats LiteLLM output to replace null values with empty arrays/objects',
        defaults: {
            name: 'LiteLLM Formatter',
        },
        inputs: [NodeConnectionType.Main],
        outputs: [NodeConnectionType.Main],
        properties: [
            {
                displayName: 'Input Field',
                name: 'inputField',
                type: 'string',
                default: 'data',
                required: true,
                description: 'The field containing the LiteLLM response data',
                placeholder: 'e.g., data or json',
            },
            {
                displayName: 'Output Field',
                name: 'outputField',
                type: 'string',
                default: 'data',
                required: true,
                description: 'The field where the formatted data will be stored',
                placeholder: 'e.g., data or formattedData',
            },
            {
                displayName: 'Options',
                name: 'options',
                type: 'collection',
                placeholder: 'Add Option',
                default: {},
                options: [
                    {
                        displayName: 'Process All Items',
                        name: 'processAllItems',
                        type: 'boolean',
                        default: true,
                        description: 'Whether to process all items or just the first one',
                    },
                    {
                        displayName: 'Strict Mode',
                        name: 'strictMode',
                        type: 'boolean',
                        default: false,
                        description: 'Whether to throw an error if the input structure is unexpected',
                    },
                ],
            },
        ],
    };

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        const items = this.getInputData();
        const returnData: INodeExecutionData[] = [];

        const inputField = this.getNodeParameter('inputField', 0) as string;
        const outputField = this.getNodeParameter('outputField', 0) as string;
        const processAllItems = this.getNodeParameter('options.processAllItems', 0, true) as boolean;
        const strictMode = this.getNodeParameter('options.strictMode', 0, false) as boolean;

        const itemsToProcess = processAllItems ? items : [items[0]];

        for (let itemIndex = 0; itemIndex < itemsToProcess.length; itemIndex++) {
            try {
                const item = itemsToProcess[itemIndex];
                
                // Get the input data from the specified field
                let inputData = item.json[inputField];
                
                if (!inputData) {
                    if (strictMode) {
                        throw new NodeOperationError(
                            this.getNode(),
                            `Input field "${inputField}" not found in item ${itemIndex}`,
                            { itemIndex }
                        );
                    }
                    returnData.push(item);
                    continue;
                }

                // If inputData is a string, try to parse it
                if (typeof inputData === 'string') {
                    try {
                        inputData = JSON.parse(inputData);
                    } catch (e) {
                        if (strictMode) {
                            throw new NodeOperationError(
                                this.getNode(),
                                `Failed to parse JSON from input field "${inputField}" in item ${itemIndex}`,
                                { itemIndex }
                            );
                        }
                        returnData.push(item);
                        continue;
                    }
                }

                // Process the data
                const formattedData = formatLiteLLMResponse(inputData, strictMode, itemIndex, this.getNode());

                // Create output item
                const newItem: INodeExecutionData = {
                    json: {
                        ...item.json,
                        [outputField]: formattedData,
                    },
                };

                if (item.binary) {
                    newItem.binary = item.binary;
                }

                if (item.pairedItem) {
                    newItem.pairedItem = item.pairedItem;
                }

                returnData.push(newItem);
            } catch (error) {
                if (error instanceof NodeOperationError) {
                    throw error;
                }
                throw new NodeOperationError(
                    this.getNode(),
                    `Error processing item ${itemIndex}: ${error.message}`,
                    { itemIndex }
                );
            }
        }

        // If not processing all items, add the remaining items unchanged
        if (!processAllItems && items.length > 1) {
            for (let i = 1; i < items.length; i++) {
                returnData.push(items[i]);
            }
        }

        return [returnData];
    }

}

function formatLiteLLMResponse(data: any, strictMode: boolean, itemIndex: number, node: any): any {
    // Deep clone the data to avoid modifying the original
    const clonedData = JSON.parse(JSON.stringify(data));

    // Check if we have a choices array
    if (clonedData.choices && Array.isArray(clonedData.choices)) {
        for (let i = 0; i < clonedData.choices.length; i++) {
            const choice = clonedData.choices[i];
            
            if (choice.message) {
                // Replace null tool_calls with empty array
                if (choice.message.tool_calls === null) {
                    choice.message.tool_calls = [];
                }
                
                // Replace null function_call with empty object
                if (choice.message.function_call === null) {
                    choice.message.function_call = {};
                }
                
                // Ensure annotations is an array (in case it's null)
                if (choice.message.annotations === null || choice.message.annotations === undefined) {
                    choice.message.annotations = [];
                }
            } else if (strictMode) {
                throw new NodeOperationError(
                    node,
                    `Choice at index ${i} does not have a message property`,
                    { itemIndex }
                );
            }
        }
    } else if (strictMode) {
        throw new NodeOperationError(
            node,
            'Input data does not have a valid choices array',
            { itemIndex }
        );
    }

    return clonedData;
}
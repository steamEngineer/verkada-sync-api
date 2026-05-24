// Basic test for postmanSync.js
import { PostmanSync } from './postmanSync.js';

// Test that the class can be instantiated
console.log('Testing PostmanSync instantiation...');

try {
  // Test with minimal parameters
  const sync = new PostmanSync('test-api-key', 'test-workspace-id');
  console.log('✓ PostmanSync instantiated successfully');
  
  // Test with collection ID
  const syncWithCollection = new PostmanSync('test-api-key', 'test-workspace-id', 'test-collection-id');
  console.log('✓ PostmanSync with collection ID instantiated successfully');
  
  // Test static methods
  const testEndpoints = [
    {
      method: 'GET',
      path: '/users',
      description: 'Get all users',
      tag: 'Users'
    },
    {
      method: 'POST',
      path: '/users',
      description: 'Create a user',
      tag: 'Users'
    }
  ];
  
  const collection = PostmanSync.convertToPostmanCollection(testEndpoints, 'Test Collection');
  console.log('✓ Postman collection conversion successful');
  console.log(`  Collection name: ${collection.info.name}`);
  console.log(`  Number of folders: ${collection.item.length}`);
  
  console.log('\nAll tests passed!');
} catch (error) {
  console.error('✗ Test failed:', error.message);
  process.exit(1);
}
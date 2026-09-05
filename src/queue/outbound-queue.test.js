const { enqueueOutboundMessage, processOutboundQueue, closeOutboundQueue } = require('./outbound-queue');

describe('outbound queue', () => {
  afterEach(async () => {
    await closeOutboundQueue();
  });

  test('a job enqueued is delivered to the processor with the right data', (done) => {
    processOutboundQueue((data) => {
      try {
        expect(data).toEqual({ conversationId: 'conv-1', channelId: 'channel-1', content: 'Ola' });
        done();
      } catch (err) {
        done(err);
      }
    });
    enqueueOutboundMessage({ conversationId: 'conv-1', channelId: 'channel-1', content: 'Ola' });
  });
});

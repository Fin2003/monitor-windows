using System.Diagnostics;

// One blocking device group owns one worker and one lock. Readers only see
// completed snapshots; timed-out calls never launch overlapping hardware reads.
internal sealed class SnapshotPoller<T> where T : class
{
    private readonly Func<T> _sample;
    private readonly Action _initialize;
    private readonly Action _close;
    private readonly TimeSpan _interval;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly CancellationTokenSource _stop = new();
    private readonly Thread _worker;
    private T? _snapshot;
    private string _error = "";
    private long _sampledAt;
    private long _durationMs;

    public SnapshotPoller(string name, TimeSpan interval, Action initialize, Func<T> sample, Action close)
    {
        _interval = interval;
        _initialize = initialize;
        _sample = sample;
        _close = close;
        _worker = new Thread(Run) { IsBackground = true, Name = name };
    }

    public T? Snapshot => Volatile.Read(ref _snapshot);
    public string Error => Volatile.Read(ref _error);
    public long SampledAt => Interlocked.Read(ref _sampledAt);
    public long DurationMs => Interlocked.Read(ref _durationMs);
    public void Start() => _worker.Start();
    public bool Stop(TimeSpan timeout)
    {
        _stop.Cancel();
        return _worker.Join(timeout);
    }

    public async Task<TResult> ExecuteAsync<TResult>(Func<TResult> operation, TimeSpan timeout, Func<T>? captureSnapshot = null)
    {
        if (!await _gate.WaitAsync(timeout, _stop.Token))
            throw new TimeoutException("Storage acquisition is busy; try again after the device responds.");
        try
        {
            _stop.Token.ThrowIfCancellationRequested();
            if (Snapshot is null) throw new InvalidOperationException("Storage acquisition is still initializing.");
            TResult result = operation();
            if (captureSnapshot is not null) Volatile.Write(ref _snapshot, captureSnapshot());
            return result;
        }
        finally { _gate.Release(); }
    }

    private void Run()
    {
        try
        {
            _gate.Wait(_stop.Token);
            try { _initialize(); }
            finally { _gate.Release(); }
            while (!_stop.IsCancellationRequested)
            {
                _gate.Wait(_stop.Token);
                try
                {
                    Stopwatch elapsed = Stopwatch.StartNew();
                    T next = _sample();
                    Volatile.Write(ref _snapshot, next);
                    Interlocked.Exchange(ref _sampledAt, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
                    Interlocked.Exchange(ref _durationMs, elapsed.ElapsedMilliseconds);
                    Volatile.Write(ref _error, "");
                }
                catch (Exception error) { Volatile.Write(ref _error, error.Message); }
                finally { _gate.Release(); }
                if (_stop.Token.WaitHandle.WaitOne(_interval)) break;
            }
        }
        catch (OperationCanceledException) when (_stop.IsCancellationRequested) { }
        catch (Exception error) { Volatile.Write(ref _error, error.Message); }
        finally
        {
            // Never close a device while its native read or control is in flight.
            _gate.Wait();
            try { _close(); }
            catch (Exception error) { Volatile.Write(ref _error, error.Message); }
            finally { _gate.Release(); }
        }
    }
}

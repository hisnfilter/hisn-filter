package ai.onnxruntime;
public class OrtEnvironment implements AutoCloseable {
  public static OrtEnvironment getEnvironment() { return null; }
  public OrtSession createSession(byte[] model, OrtSession.SessionOptions o) throws OrtException { return null; }
  public void close() {}
}

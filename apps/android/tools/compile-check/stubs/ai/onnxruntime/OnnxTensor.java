package ai.onnxruntime;
import java.nio.*;
public class OnnxTensor extends OnnxTensorLike implements OnnxValue {
  public static OnnxTensor createTensor(OrtEnvironment e, FloatBuffer b, long[] shape) throws OrtException { return null; }
  public static OnnxTensor createTensor(OrtEnvironment e, IntBuffer b, long[] shape) throws OrtException { return null; }
  public FloatBuffer getFloatBuffer() { return null; }
  public Object getValue() { return null; }
  public void close() {}
}
